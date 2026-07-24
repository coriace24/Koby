// AI usage accounting and the credit scaffold.
//
// Every AI invocation is recorded in AiRun with its token counts and estimated
// cost. Credits (CreditLedger) are recorded but NOT enforced until
// BILLING_ENFORCED=true — flip that env var once payments exist. One credit is
// intended to equal one AI run.
import { prisma } from "./db";

// Price card, USD per million tokens (input, output).
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};
const DEFAULT_PRICE = { input: 5, output: 25 };

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICES[model] ?? DEFAULT_PRICE;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export async function recordAiRun(params: {
  userId: string;
  analysisId?: string;
  mode: "extraction" | "summary";
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  await prisma.aiRun.create({
    data: {
      ...params,
      costUsd: estimateCostUsd(params.model, params.inputTokens, params.outputTokens),
    },
  });
}

export async function usageSummary(userId: string) {
  const agg = await prisma.aiRun.aggregate({
    where: { userId },
    _count: true,
    _sum: { inputTokens: true, outputTokens: true, costUsd: true },
  });
  return {
    runs: agg._count,
    inputTokens: agg._sum.inputTokens ?? 0,
    outputTokens: agg._sum.outputTokens ?? 0,
    costUsd: agg._sum.costUsd ?? 0,
  };
}

// ---------- Credits ----------

export function billingEnforced(): boolean {
  return process.env.BILLING_ENFORCED === "true";
}

export async function creditBalance(userId: string): Promise<number> {
  const agg = await prisma.creditLedger.aggregate({ where: { userId }, _sum: { delta: true } });
  return agg._sum.delta ?? 0;
}

export async function grantCredits(userId: string, amount: number, reason = "grant"): Promise<void> {
  await prisma.creditLedger.create({ data: { userId, delta: amount, reason } });
}

// Returns null when the run may proceed, or an error message when blocked.
// Consumption is recorded even while enforcement is off, so history is complete
// the day billing turns on.
export async function consumeCreditForRun(userId: string): Promise<string | null> {
  if (billingEnforced()) {
    const balance = await creditBalance(userId);
    if (balance < 1) {
      return "You have no AI credits left. Purchase credits to run more AI analyses.";
    }
  }
  await prisma.creditLedger.create({ data: { userId, delta: -1, reason: "ai_run" } });
  return null;
}
