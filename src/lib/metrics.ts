import type { Analysis } from "@prisma/client";
import type { Extraction } from "./ai";
import {
  underwrite,
  rentGrowth,
  renovationAnalysis,
  stabilized,
  type UnderwritingResult,
  type RentGrowthResult,
  type RenovationResult,
  type StabilizedResult,
  type IncomeStatement,
  type ExpenseStatement,
  type FinancingInputs,
} from "./underwriting";

export interface FullMetrics {
  income: IncomeStatement;
  expenses: ExpenseStatement;
  base: UnderwritingResult;
  rentGrowth: RentGrowthResult | null;
  renovation: RenovationResult | null;
  stabilized: StabilizedResult | null;
}

export function parseExtraction(analysis: Analysis): Extraction | null {
  if (!analysis.extraction) return null;
  try {
    return JSON.parse(analysis.extraction) as Extraction;
  } catch {
    return null;
  }
}

export function computeMetrics(analysis: Analysis, extraction: Extraction | null): FullMetrics | null {
  if (!extraction) return null;

  const income: IncomeStatement = {
    grossPotentialRent: extraction.income.grossPotentialRent.annualAmount,
    actualCollectedRent: extraction.income.actualCollectedRent.annualAmount,
    vacancyLoss: extraction.income.vacancyLoss.annualAmount,
    otherIncome: extraction.income.otherIncome.annualAmount,
  };
  const expenses: ExpenseStatement = {
    propertyTaxes: extraction.expenses.propertyTaxes.annualAmount,
    insurance: extraction.expenses.insurance.annualAmount,
    utilities: extraction.expenses.utilities.annualAmount,
    repairsMaintenance: extraction.expenses.repairsMaintenance.annualAmount,
    managementFees: extraction.expenses.managementFees.annualAmount,
    payroll: extraction.expenses.payroll.annualAmount,
    landscaping: extraction.expenses.landscaping.annualAmount,
    administrative: extraction.expenses.administrative.annualAmount,
    other: extraction.expenses.other.annualAmount,
  };
  const financing: FinancingInputs = {
    purchasePrice: analysis.purchasePrice,
    loanAmount: analysis.loanAmount,
    interestRate: analysis.interestRate,
    loanTermYears: analysis.loanTermYears,
    downPayment: analysis.downPayment,
  };

  const renovationBudget = analysis.renovationBudget ?? 0;
  const base = underwrite(income, expenses, financing, renovationBudget);

  const avgRent =
    extraction.rentRoll.averageRentPerUnit ||
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
      ? stabilized(
          base,
          addedIncome,
          analysis.vacancyAssumption ?? 5,
          financing,
          renovationBudget
        )
      : null;

  return { income, expenses, base, rentGrowth: growth, renovation: reno, stabilized: stab };
}
