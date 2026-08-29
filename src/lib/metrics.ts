import type { Analysis } from "@prisma/client";
import { normalizeExtraction, INCOME_KEYS, type Extraction } from "./ai";
import {
  underwrite,
  emptyExpenses,
  EXPENSE_KEYS,
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
  belowNoiTotal: number; // capex/TI/LC/debt/D&A found in documents — excluded from NOI
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
    // Normalizing fills every dictionary category, so extractions stored
    // before the dictionary restructure keep working.
    return normalizeExtraction(JSON.parse(analysis.extraction));
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

// The 8 income categories that add to income (the other 4 are base rent + reductions).
const OTHER_INCOME_KEYS = INCOME_KEYS.filter(
  (k) => !["grossPotentialRent", "vacancyLoss", "badDebt", "concessions"].includes(k)
);

export function parseManualOpex(analysis: Analysis): ExpenseStatement | null {
  if (!analysis.manualOpex) return null;
  try {
    const raw = JSON.parse(analysis.manualOpex) as Record<string, unknown>;
    const out = emptyExpenses();
    for (const k of EXPENSE_KEYS) {
      const v = raw[k];
      out[k] = typeof v === "number" && Number.isFinite(v) ? v : 0;
    }
    return out;
  } catch {
    return null;
  }
}

function fromExtraction(extraction: Extraction): {
  income: IncomeStatement;
  expenses: ExpenseStatement;
} {
  const income: IncomeStatement = {
    baseRent: extraction.income.grossPotentialRent.annualAmount,
    vacancyLoss: extraction.income.vacancyLoss.annualAmount,
    badDebt: extraction.income.badDebt.annualAmount,
    concessions: extraction.income.concessions.annualAmount,
    otherIncome: OTHER_INCOME_KEYS.reduce((s, k) => s + extraction.income[k].annualAmount, 0),
  };
  // Pre-dictionary extractions carry collected rent; it overrides the
  // reduction math so old analyses keep their numbers until re-run.
  const legacy = extraction.income.actualCollectedRent?.annualAmount ?? 0;
  if (legacy > 0) income.legacyActualCollected = legacy;

  const expenses = emptyExpenses();
  for (const k of EXPENSE_KEYS) expenses[k] = extraction.expenses[k].annualAmount;
  return { income, expenses };
}

export function belowNoiTotalOf(extraction: Extraction | null): number {
  if (!extraction) return 0;
  return Object.values(extraction.belowNoi).reduce((s, it) => s + (it?.annualAmount || 0), 0);
}

function fromManual(analysis: Analysis): { income: IncomeStatement; expenses: ExpenseStatement } | null {
  const mix = parseUnitMix(analysis);
  const opex = parseManualOpex(analysis);
  if (mix.length === 0 && !opex) return null;

  const monthlyRent = unitMixMonthlyRent(mix);
  const vacancyPct = analysis.vacancyAssumption ?? 5;
  const income: IncomeStatement = {
    baseRent: monthlyRent * 12,
    vacancyLoss: monthlyRent * 12 * (vacancyPct / 100),
    badDebt: 0,
    concessions: 0,
    otherIncome: (analysis.otherIncomeMonthly ?? 0) * 12,
  };
  return { income, expenses: opex ?? emptyExpenses() };
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
    (analysis.units > 0 ? income.baseRent / analysis.units / 12 : 0);

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
    belowNoiTotal: source === "documents" ? belowNoiTotalOf(extraction) : 0,
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
