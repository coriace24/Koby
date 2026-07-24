import type { Analysis } from "@prisma/client";
import type { Extraction } from "./ai";
import {
  underwrite,
  rentGrowth,
  renovationAnalysis,
  stabilized,
  cashNeeded,
  capRateValuation,
  rentSensitivity,
  unitMixMonthlyRent,
  holdProjection,
  type HoldProjectionResult,
  type UnderwritingResult,
  type RentGrowthResult,
  type RenovationResult,
  type StabilizedResult,
  type IncomeStatement,
  type ExpenseStatement,
  type FinancingInputs,
  type CashNeeded,
  type CapRateValuationRow,
  type RentSensitivityRow,
  type UnitMixRow,
} from "./underwriting";

export interface MetricsOptions {
  capRateBands?: number[]; // e.g. [6, 7, 8]
  whatIfRentDelta?: number; // $/month
  // "auto" (default): documents win when analyzed, else manual.
  // "manual" / "documents": force that source (null when it has no data).
  source?: "auto" | "manual" | "documents";
}

export interface FullMetrics {
  dataSource: "documents" | "manual";
  income: IncomeStatement;
  expenses: ExpenseStatement;
  base: UnderwritingResult;
  cashNeeded: CashNeeded;
  capRateMatrix: CapRateValuationRow[];
  sensitivity: RentSensitivityRow[];
  pricePerUnit: number | null;
  askingPricePerUnit: number | null;
  rentGrowth: RentGrowthResult | null;
  renovation: RenovationResult | null;
  stabilized: StabilizedResult | null;
  projection: HoldProjectionResult | null;
}

export function parseExtraction(analysis: Analysis): Extraction | null {
  if (!analysis.extraction) return null;
  try {
    return JSON.parse(analysis.extraction) as Extraction;
  } catch {
    return null;
  }
}

export function parseUnitMix(analysis: Analysis): UnitMixRow[] {
  if (!analysis.unitMix) return [];
  try {
    const rows = JSON.parse(analysis.unitMix);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

const EXPENSE_KEYS = [
  "propertyTaxes", "insurance", "utilities", "repairsMaintenance", "managementFees",
  "payroll", "landscaping", "administrative", "other",
] as const;

export function parseManualOpex(analysis: Analysis): ExpenseStatement | null {
  if (!analysis.manualOpex) return null;
  try {
    const raw = JSON.parse(analysis.manualOpex) as Record<string, unknown>;
    const out = {} as Record<string, number>;
    for (const k of EXPENSE_KEYS) {
      const v = raw[k];
      out[k] = typeof v === "number" && Number.isFinite(v) ? v : 0;
    }
    return out as unknown as ExpenseStatement;
  } catch {
    return null;
  }
}

function fromExtraction(extraction: Extraction): { income: IncomeStatement; expenses: ExpenseStatement } {
  return {
    income: {
      grossPotentialRent: extraction.income.grossPotentialRent.annualAmount,
      actualCollectedRent: extraction.income.actualCollectedRent.annualAmount,
      vacancyLoss: extraction.income.vacancyLoss.annualAmount,
      otherIncome: extraction.income.otherIncome.annualAmount,
    },
    expenses: {
      propertyTaxes: extraction.expenses.propertyTaxes.annualAmount,
      insurance: extraction.expenses.insurance.annualAmount,
      utilities: extraction.expenses.utilities.annualAmount,
      repairsMaintenance: extraction.expenses.repairsMaintenance.annualAmount,
      managementFees: extraction.expenses.managementFees.annualAmount,
      payroll: extraction.expenses.payroll.annualAmount,
      landscaping: extraction.expenses.landscaping.annualAmount,
      administrative: extraction.expenses.administrative.annualAmount,
      other: extraction.expenses.other.annualAmount,
    },
  };
}

function fromManual(analysis: Analysis): { income: IncomeStatement; expenses: ExpenseStatement } | null {
  const mix = parseUnitMix(analysis);
  const opex = parseManualOpex(analysis);
  if (mix.length === 0 && !opex) return null;

  const monthlyRent = unitMixMonthlyRent(mix);
  const vacancyPct = analysis.vacancyAssumption ?? 5;
  const income: IncomeStatement = {
    grossPotentialRent: monthlyRent * 12,
    actualCollectedRent: 0, // engine falls back to GPR - vacancy
    vacancyLoss: monthlyRent * 12 * (vacancyPct / 100),
    otherIncome: (analysis.otherIncomeMonthly ?? 0) * 12,
  };
  const expenses: ExpenseStatement = opex ?? {
    propertyTaxes: 0, insurance: 0, utilities: 0, repairsMaintenance: 0, managementFees: 0,
    payroll: 0, landscaping: 0, administrative: 0, other: 0,
  };
  return { income, expenses };
}

export function computeMetrics(
  analysis: Analysis,
  extraction: Extraction | null,
  opts: MetricsOptions = {}
): FullMetrics | null {
  const wanted = opts.source ?? "auto";
  let source: "documents" | "manual";
  let statements: { income: IncomeStatement; expenses: ExpenseStatement } | null;
  if (wanted === "documents") {
    source = "documents";
    statements = extraction ? fromExtraction(extraction) : null;
  } else if (wanted === "manual") {
    source = "manual";
    statements = fromManual(analysis);
  } else {
    // auto: documents win when analyzed; otherwise fall back to the manual deal calculator
    source = extraction ? "documents" : "manual";
    statements = extraction ? fromExtraction(extraction) : fromManual(analysis);
  }
  if (!statements) return null;

  const { income, expenses } = statements;
  const financing: FinancingInputs = {
    purchasePrice: analysis.purchasePrice,
    loanAmount: analysis.loanAmount,
    interestRate: analysis.interestRate,
    loanTermYears: analysis.loanTermYears,
    downPayment: analysis.downPayment,
    closingCosts: analysis.closingCosts ?? undefined,
    carryingCosts: analysis.carryingCosts ?? undefined,
  };

  const renovationBudget = analysis.renovationBudget ?? 0;
  const base = underwrite(income, expenses, financing, renovationBudget);
  const cash = cashNeeded(financing, renovationBudget);

  const bands = opts.capRateBands && opts.capRateBands.length > 0 ? opts.capRateBands : [6, 7, 8];
  const matrix = capRateValuation(base.noi, bands, analysis.purchasePrice, analysis.askingPrice ?? null);

  const delta = opts.whatIfRentDelta && opts.whatIfRentDelta > 0 ? opts.whatIfRentDelta : 500;
  const sensitivity = rentSensitivity(
    base.effectiveGrossIncome / 12,
    delta,
    base.totalOperatingExpenses / 12,
    base.monthlyDebtService,
    cash.total
  );

  const avgRent =
    (extraction?.rentRoll.averageRentPerUnit || 0) ||
    (analysis.units > 0 ? income.grossPotentialRent / analysis.units / 12 : 0);

  const growth =
    analysis.marketRentPerUnit && analysis.marketRentPerUnit > 0
      ? rentGrowth(avgRent, analysis.marketRentPerUnit, analysis.units)
      : null;

  const reno =
    analysis.renoCostPerUnit && analysis.renoUnitCount && analysis.renoRentIncrease
      ? renovationAnalysis(
          analysis.renoCostPerUnit,
          analysis.renoUnitCount,
          analysis.renoRentIncrease,
          analysis.exitCapRate ?? undefined
        )
      : null;

  const addedIncome =
    (growth?.annualRevenueIncrease ?? 0) + (reno?.additionalAnnualIncome ?? 0);

  const stab =
    addedIncome > 0
      ? stabilized(base, addedIncome, analysis.vacancyAssumption ?? 5, financing, renovationBudget)
      : null;

  const projection =
    analysis.holdYears && analysis.holdYears > 0 && analysis.exitCapRate && analysis.exitCapRate > 0
      ? holdProjection(
          base,
          financing,
          {
            holdYears: analysis.holdYears,
            rentGrowthPct: analysis.rentGrowthPct ?? 2,
            expenseGrowthPct: analysis.expenseGrowthPct ?? 2,
            exitCapRatePct: analysis.exitCapRate,
            saleCostPct: analysis.saleCostPct ?? 5,
          },
          renovationBudget
        )
      : null;

  return {
    dataSource: source,
    income,
    expenses,
    base,
    cashNeeded: cash,
    capRateMatrix: matrix,
    sensitivity,
    pricePerUnit: analysis.units > 0 ? analysis.purchasePrice / analysis.units : null,
    askingPricePerUnit:
      analysis.askingPrice && analysis.units > 0 ? analysis.askingPrice / analysis.units : null,
    rentGrowth: growth,
    renovation: reno,
    stabilized: stab,
    projection,
  };
}

export function parseCapRateBands(csv: string | null | undefined): number[] {
  if (!csv) return [6, 7, 8];
  const bands = csv
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 30);
  return bands.length > 0 ? bands.slice(0, 6) : [6, 7, 8];
}
