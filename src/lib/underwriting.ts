// Deterministic underwriting engine. All money values are annual USD unless noted.

export interface IncomeStatement {
  grossPotentialRent: number;
  actualCollectedRent: number;
  vacancyLoss: number;
  otherIncome: number;
}

export interface ExpenseStatement {
  propertyTaxes: number;
  insurance: number;
  utilities: number;
  repairsMaintenance: number;
  managementFees: number;
  payroll: number;
  landscaping: number;
  administrative: number;
  other: number;
}

export interface FinancingInputs {
  purchasePrice: number;
  loanAmount: number;
  interestRate: number; // annual percent, e.g. 6.5
  loanTermYears: number;
  downPayment: number;
  closingCosts?: number;
  carryingCosts?: number;
}

export interface CashNeeded {
  downPayment: number;
  closingCosts: number;
  carryingCosts: number;
  renovationBudget: number;
  total: number;
}

export function cashNeeded(f: FinancingInputs, renovationBudget = 0): CashNeeded {
  const closing = f.closingCosts ?? 0;
  const carrying = f.carryingCosts ?? 0;
  return {
    downPayment: f.downPayment,
    closingCosts: closing,
    carryingCosts: carrying,
    renovationBudget,
    total: f.downPayment + closing + carrying + renovationBudget,
  };
}

export interface UnderwritingResult {
  effectiveGrossIncome: number;
  totalOperatingExpenses: number;
  noi: number;
  capRate: number; // percent
  monthlyDebtService: number;
  annualDebtService: number;
  dscr: number | null;
  cashFlowAfterDebtService: number;
  equityRequirement: number;
  cashOnCashReturn: number | null; // percent
  expenseRatio: number | null; // percent of EGI
  breakEvenOccupancy: number | null; // percent of gross potential income
}

export function totalExpenses(e: ExpenseStatement): number {
  return (
    e.propertyTaxes +
    e.insurance +
    e.utilities +
    e.repairsMaintenance +
    e.managementFees +
    e.payroll +
    e.landscaping +
    e.administrative +
    e.other
  );
}

export function effectiveGrossIncome(i: IncomeStatement): number {
  // Prefer actual collections when available; otherwise GPR less vacancy.
  const rental =
    i.actualCollectedRent > 0
      ? i.actualCollectedRent
      : Math.max(i.grossPotentialRent - i.vacancyLoss, 0);
  return rental + i.otherIncome;
}

export function monthlyPayment(principal: number, annualRatePct: number, termYears: number): number {
  if (principal <= 0 || termYears <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = termYears * 12;
  if (r === 0) return principal / n;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

export function underwrite(
  income: IncomeStatement,
  expenses: ExpenseStatement,
  financing: FinancingInputs,
  renovationBudget = 0
): UnderwritingResult {
  const egi = effectiveGrossIncome(income);
  const opex = totalExpenses(expenses);
  const noi = egi - opex;

  const mPay = monthlyPayment(financing.loanAmount, financing.interestRate, financing.loanTermYears);
  const annualDebt = mPay * 12;

  // Cash-on-cash uses total cash needed (down payment + closing + carrying + reno),
  // mirroring the reference deal calculator.
  const equity = cashNeeded(financing, renovationBudget).total;
  const cashFlow = noi - annualDebt;

  const gpi = income.grossPotentialRent + income.otherIncome;

  return {
    effectiveGrossIncome: egi,
    totalOperatingExpenses: opex,
    noi,
    capRate: financing.purchasePrice > 0 ? (noi / financing.purchasePrice) * 100 : 0,
    monthlyDebtService: mPay,
    annualDebtService: annualDebt,
    dscr: annualDebt > 0 ? noi / annualDebt : null,
    cashFlowAfterDebtService: cashFlow,
    equityRequirement: equity,
    cashOnCashReturn: equity > 0 ? (cashFlow / equity) * 100 : null,
    expenseRatio: egi > 0 ? (opex / egi) * 100 : null,
    breakEvenOccupancy: gpi > 0 ? ((opex + annualDebt) / gpi) * 100 : null,
  };
}

// ---------- Deal-calculator additions (from the reference Excel calculator) ----------

export interface UnitMixRow {
  label: string; // e.g. "2BR/1BA"
  count: number;
  rent: number; // $/unit/month
  fee: number; // NNN / utility fee, $/unit/month
}

export function unitMixMonthlyRent(rows: UnitMixRow[]): number {
  return rows.reduce((sum, r) => sum + (r.count || 0) * ((r.rent || 0) + (r.fee || 0)), 0);
}

export interface CapRateValuationRow {
  capRatePct: number;
  impliedValue: number; // NOI / cap rate
  vsAsking: number | null; // impliedValue - askingPrice
  vsOffer: number; // impliedValue - offer (purchase price)
}

// "What is this property worth at an X% cap?" — the calculator's CAP Rates table.
export function capRateValuation(
  noi: number,
  bands: number[],
  offer: number,
  asking: number | null
): CapRateValuationRow[] {
  return bands
    .filter((b) => b > 0)
    .map((b) => {
      const value = noi / (b / 100);
      return {
        capRatePct: b,
        impliedValue: value,
        vsAsking: asking !== null && asking > 0 ? value - asking : null,
        vsOffer: value - offer,
      };
    });
}

export interface RentSensitivityRow {
  monthlyRentDelta: number; // -delta | 0 | +delta
  effectiveMonthlyIncome: number;
  annualCashFlow: number;
  cashOnCash: number | null; // percent
}

// The calculator's "What If?" table: cash-on-cash at rent -Δ / base / +Δ per month.
export function rentSensitivity(
  baseMonthlyIncome: number, // effective gross income / 12
  delta: number,
  monthlyOpex: number,
  monthlyDebt: number,
  totalCashNeeded: number
): RentSensitivityRow[] {
  return [-delta, 0, delta].map((d) => {
    const income = baseMonthlyIncome + d;
    const annualCf = (income - monthlyOpex - monthlyDebt) * 12;
    return {
      monthlyRentDelta: d,
      effectiveMonthlyIncome: income,
      annualCashFlow: annualCf,
      cashOnCash: totalCashNeeded > 0 ? (annualCf / totalCashNeeded) * 100 : null,
    };
  });
}

// ---------- Value-add analysis ----------

export interface RentGrowthResult {
  currentAvgRent: number; // $/unit/month
  marketRent: number; // $/unit/month
  perUnitMonthlyIncrease: number;
  annualRevenueIncrease: number;
}

export function rentGrowth(
  currentAvgRentPerUnit: number,
  marketRentPerUnit: number,
  units: number
): RentGrowthResult {
  const perUnit = Math.max(marketRentPerUnit - currentAvgRentPerUnit, 0);
  return {
    currentAvgRent: currentAvgRentPerUnit,
    marketRent: marketRentPerUnit,
    perUnitMonthlyIncrease: perUnit,
    annualRevenueIncrease: perUnit * units * 12,
  };
}

export interface RenovationResult {
  totalInvestment: number;
  additionalAnnualIncome: number;
  returnOnRenovation: number | null; // percent
  valueImpactAtExitCap: number | null; // added value = added NOI / exit cap
}

export function renovationAnalysis(
  costPerUnit: number,
  unitCount: number,
  rentIncreasePerUnit: number, // $/unit/month
  exitCapRatePct?: number
): RenovationResult {
  const total = costPerUnit * unitCount;
  const addedIncome = rentIncreasePerUnit * unitCount * 12;
  return {
    totalInvestment: total,
    additionalAnnualIncome: addedIncome,
    returnOnRenovation: total > 0 ? (addedIncome / total) * 100 : null,
    valueImpactAtExitCap:
      exitCapRatePct && exitCapRatePct > 0 ? addedIncome / (exitCapRatePct / 100) : null,
  };
}

export interface StabilizedResult {
  stabilizedNoi: number;
  stabilizedCapRate: number; // percent on purchase price
  stabilizedCashFlow: number;
  stabilizedCashOnCash: number | null;
}

// Stabilized projection: current NOI plus rent-growth and renovation income,
// with a vacancy haircut applied to the added revenue.
export function stabilized(
  base: UnderwritingResult,
  addedAnnualIncome: number,
  vacancyPct: number,
  financing: FinancingInputs,
  renovationBudget = 0
): StabilizedResult {
  const effectiveAdded = addedAnnualIncome * (1 - vacancyPct / 100);
  const noi = base.noi + effectiveAdded;
  const cashFlow = noi - base.annualDebtService;
  const equity = financing.downPayment + renovationBudget;
  return {
    stabilizedNoi: noi,
    stabilizedCapRate: financing.purchasePrice > 0 ? (noi / financing.purchasePrice) * 100 : 0,
    stabilizedCashFlow: cashFlow,
    stabilizedCashOnCash: equity > 0 ? (cashFlow / equity) * 100 : null,
  };
}
