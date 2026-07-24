import { describe, it, expect } from "vitest";
import {
  monthlyPayment,
  underwrite,
  cashNeeded,
  capRateValuation,
  rentSensitivity,
  unitMixMonthlyRent,
  rentGrowth,
  renovationAnalysis,
  stabilized,
  loanBalanceAfter,
  irr,
  holdProjection,
  type IncomeStatement,
  type ExpenseStatement,
  type FinancingInputs,
} from "./underwriting";

// The reference deal from the original Excel calculator ("18th and Wayne"):
// $1M offer, 20% down, $10k closing, $800k loan @ 6.5% / 25yr,
// $10,800/mo scheduled rent at 5% vacancy, $44,800/yr opex.
const excelIncome: IncomeStatement = {
  grossPotentialRent: 10800 * 12,
  actualCollectedRent: 10260 * 12, // vacancy-adjusted collections
  vacancyLoss: 540 * 12,
  otherIncome: 0,
};
const excelExpenses: ExpenseStatement = {
  propertyTaxes: 24000,
  insurance: 7000,
  utilities: 0,
  repairsMaintenance: 8000,
  managementFees: 0,
  payroll: 0,
  landscaping: 4800,
  administrative: 0,
  other: 1000,
};
const excelFinancing: FinancingInputs = {
  purchasePrice: 1_000_000,
  loanAmount: 800_000,
  interestRate: 6.5,
  loanTermYears: 25,
  downPayment: 200_000,
  closingCosts: 10_000,
  carryingCosts: 0,
};

describe("monthlyPayment", () => {
  it("matches Excel PMT for the reference loan", () => {
    expect(monthlyPayment(800_000, 6.5, 25)).toBeCloseTo(5401.657290781117, 6);
  });
  it("handles zero interest as straight-line", () => {
    expect(monthlyPayment(120_000, 0, 10)).toBeCloseTo(1000, 10);
  });
  it("returns 0 for empty loans", () => {
    expect(monthlyPayment(0, 6.5, 30)).toBe(0);
  });
});

describe("underwrite — reference deal", () => {
  const r = underwrite(excelIncome, excelExpenses, excelFinancing);

  it("reproduces the Excel calculator to the cent", () => {
    expect(r.noi).toBeCloseTo(78_320, 6);
    expect(r.capRate).toBeCloseTo(7.832, 6);
    expect(r.dscr!).toBeCloseTo(1.2082711500053098, 9);
    expect(r.annualDebtService).toBeCloseTo(64_819.8874893734, 4);
    expect(r.cashOnCashReturn!).toBeCloseTo(6.42862500506028, 6);
    expect(r.equityRequirement).toBe(210_000);
  });

  it("computes break-even occupancy against gross scheduled income", () => {
    // (opex + debt) / GPI
    const expected = ((44_800 + r.annualDebtService) / (10_800 * 12)) * 100;
    expect(r.breakEvenOccupancy!).toBeCloseTo(expected, 6);
  });
});

describe("cashNeeded", () => {
  it("sums down payment, closing, carrying, and renovation", () => {
    const c = cashNeeded({ ...excelFinancing, carryingCosts: 5_000 }, 25_000);
    expect(c.total).toBe(240_000);
  });
});

describe("capRateValuation", () => {
  it("matches the Excel CAP Rates table", () => {
    const rows = capRateValuation(78_320, [8, 7, 6], 1_000_000, 1_300_000);
    expect(rows[0].impliedValue).toBeCloseTo(979_000, 4);
    expect(rows[1].impliedValue).toBeCloseTo(1_118_857.1428571427, 4);
    expect(rows[2].impliedValue).toBeCloseTo(1_305_333.3333333335, 4);
    expect(rows[2].vsAsking!).toBeCloseTo(5_333.333333, 2);
  });
});

describe("rentSensitivity", () => {
  it("matches the Excel What-If table", () => {
    const r = underwrite(excelIncome, excelExpenses, excelFinancing);
    const rows = rentSensitivity(
      r.effectiveGrossIncome / 12,
      500,
      r.totalOperatingExpenses / 12,
      r.monthlyDebtService,
      210_000
    );
    expect(rows[0].cashOnCash!).toBeCloseTo(3.5714821479174236, 6);
    expect(rows[1].cashOnCash!).toBeCloseTo(6.42862500506028, 6);
    expect(rows[2].cashOnCash!).toBeCloseTo(9.285767862203138, 6);
  });
});

describe("unitMixMonthlyRent", () => {
  it("sums count × (rent + fee)", () => {
    expect(
      unitMixMonthlyRent([
        { label: "1BR", count: 9, rent: 850, fee: 0 },
        { label: "2BR", count: 6, rent: 950, fee: 50 },
      ])
    ).toBe(9 * 850 + 6 * 1000);
  });
});

describe("value-add", () => {
  it("rent growth: PRD example ($850 → $1,050 on 5 units = $12,000/yr)", () => {
    const g = rentGrowth(850, 1050, 5);
    expect(g.perUnitMonthlyIncrease).toBe(200);
    expect(g.annualRevenueIncrease).toBe(12_000);
  });

  it("renovation ROI and value impact", () => {
    const r = renovationAnalysis(5000, 10, 150, 6.5);
    expect(r.totalInvestment).toBe(50_000);
    expect(r.additionalAnnualIncome).toBe(18_000);
    expect(r.returnOnRenovation!).toBeCloseTo(36, 8);
    expect(r.valueImpactAtExitCap!).toBeCloseTo(18_000 / 0.065, 4);
  });

  it("stabilized applies the vacancy haircut to added income only", () => {
    const base = underwrite(excelIncome, excelExpenses, excelFinancing);
    const s = stabilized(base, 12_000, 5, excelFinancing);
    expect(s.stabilizedNoi).toBeCloseTo(base.noi + 12_000 * 0.95, 6);
  });
});

describe("loanBalanceAfter", () => {
  it("is the full principal at month 0 and ~0 at maturity", () => {
    expect(loanBalanceAfter(800_000, 6.5, 25, 0)).toBeCloseTo(800_000, 4);
    expect(loanBalanceAfter(800_000, 6.5, 25, 300)).toBeCloseTo(0, 4);
  });
  it("declines monotonically", () => {
    const b5 = loanBalanceAfter(800_000, 6.5, 25, 60);
    const b10 = loanBalanceAfter(800_000, 6.5, 25, 120);
    expect(b5).toBeGreaterThan(b10);
    expect(b5).toBeLessThan(800_000);
  });
  it("handles zero-rate loans", () => {
    expect(loanBalanceAfter(120_000, 0, 10, 60)).toBeCloseTo(60_000, 8);
  });
});

describe("irr", () => {
  it("solves a textbook case", () => {
    // -1000 now, +500/yr for 3 years → IRR ≈ 23.375%
    expect(irr([-1000, 500, 500, 500])!).toBeCloseTo(23.375, 1);
  });
  it("returns ~0 for exact payback", () => {
    expect(irr([-1000, 1000])!).toBeCloseTo(0, 4);
  });
  it("rejects flows without a leading investment", () => {
    expect(irr([1000, -500])).toBeNull();
  });
});

describe("holdProjection", () => {
  const base = underwrite(excelIncome, excelExpenses, excelFinancing);
  const p = holdProjection(base, excelFinancing, {
    holdYears: 5,
    rentGrowthPct: 2,
    expenseGrowthPct: 2,
    exitCapRatePct: 7,
    saleCostPct: 5,
  });

  it("grows income and expenses annually", () => {
    expect(p.years).toHaveLength(5);
    expect(p.years[0].noi).toBeCloseTo(base.noi, 6);
    expect(p.years[4].effectiveGrossIncome).toBeCloseTo(
      base.effectiveGrossIncome * Math.pow(1.02, 4),
      6
    );
  });

  it("prices the sale on forward NOI at the exit cap", () => {
    const forwardNoi =
      base.effectiveGrossIncome * Math.pow(1.02, 5) -
      base.totalOperatingExpenses * Math.pow(1.02, 5);
    expect(p.salePrice).toBeCloseTo(forwardNoi / 0.07, 4);
  });

  it("nets out sale costs and the remaining loan balance", () => {
    const balance = loanBalanceAfter(800_000, 6.5, 25, 60);
    expect(p.netSaleProceeds).toBeCloseTo(p.salePrice * 0.95 - balance, 4);
  });

  it("produces consistent totals, multiple, and a sane IRR", () => {
    expect(p.totalProfit).toBeCloseTo(p.totalCashFlow + p.netSaleProceeds - 210_000, 6);
    expect(p.equityMultiple!).toBeCloseTo((p.totalCashFlow + p.netSaleProceeds) / 210_000, 8);
    expect(p.irrPct!).toBeGreaterThan(5);
    expect(p.irrPct!).toBeLessThan(50);
    // IRR must discount the flows to ~zero NPV
    const flows = [-210_000, ...p.years.map((y, i) => y.cashFlow + (i === 4 ? p.netSaleProceeds : 0))];
    const npv = flows.reduce((s, cf, t) => s + cf / Math.pow(1 + p.irrPct! / 100, t), 0);
    expect(Math.abs(npv)).toBeLessThan(1);
  });
});
