import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { computeMetrics, parseExtraction, parseCapRateBands, type MetricsOptions } from "@/lib/metrics";
import { getOrCreateSettings } from "@/lib/settings";

async function getOwnedAnalysis(id: string, userId: string) {
  return prisma.analysis.findFirst({ where: { id, userId }, include: { documents: true } });
}

async function metricsOptions(userId: string): Promise<MetricsOptions> {
  const s = await getOrCreateSettings(userId);
  return { capRateBands: parseCapRateBands(s.capRateBands), whatIfRentDelta: s.whatIfRentDelta };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const analysis = await getOwnedAnalysis(id, userId);
  if (!analysis) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const extraction = parseExtraction(analysis);
  const opts = await metricsOptions(userId);
  const metrics = computeMetrics(analysis, extraction, opts);
  const metricsManual = computeMetrics(analysis, extraction, { ...opts, source: "manual" });
  const metricsDocuments = computeMetrics(analysis, extraction, { ...opts, source: "documents" });
  const aiSummary = analysis.aiSummary ? JSON.parse(analysis.aiSummary) : null;

  return NextResponse.json({
    ...analysis,
    extractionParsed: extraction,
    metrics,
    metricsManual,
    metricsDocuments,
    aiSummaryParsed: aiSummary,
  });
}

const EDITABLE_NUMERIC = [
  "purchasePrice", "askingPrice", "units", "yearBuilt", "occupancy",
  "loanAmount", "interestRate", "loanTermYears", "downPayment",
  "closingCosts", "carryingCosts", "otherIncomeMonthly",
  "renovationBudget", "targetReturn",
  "marketRentPerUnit", "renoCostPerUnit", "renoUnitCount", "renoRentIncrease",
  "exitCapRate", "vacancyAssumption",
  "holdYears", "rentGrowthPct", "expenseGrowthPct", "saleCostPct",
] as const;
const EDITABLE_STRING = ["address", "propertyType", "strategy", "notes"] as const;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.analysis.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const b = await request.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const data: Record<string, unknown> = {};
  for (const key of EDITABLE_NUMERIC) {
    if (key in b) {
      const raw = b[key];
      if (raw === null || raw === "") {
        data[key] = null;
      } else {
        const n = typeof raw === "string" ? parseFloat(raw) : raw;
        if (typeof n === "number" && Number.isFinite(n)) {
          data[key] = ["units", "yearBuilt", "loanTermYears", "renoUnitCount", "holdYears"].includes(key)
            ? Math.round(n)
            : n;
        }
      }
    }
  }
  for (const key of EDITABLE_STRING) {
    if (key in b && (typeof b[key] === "string" || b[key] === null)) data[key] = b[key] || null;
  }
  // Allow editing extraction values (user overrides of AI-extracted figures)
  if (typeof b.extraction === "string") data.extraction = b.extraction;
  if (b.extraction && typeof b.extraction === "object") data.extraction = JSON.stringify(b.extraction);

  // Manual deal-calculator inputs
  if (Array.isArray(b.unitMix)) {
    const rows = b.unitMix
      .filter((r: unknown) => r && typeof r === "object")
      .slice(0, 40)
      .map((r: Record<string, unknown>) => ({
        label: typeof r.label === "string" ? r.label.slice(0, 60) : "",
        count: Math.max(0, Math.round(Number(r.count) || 0)),
        rent: Math.max(0, Number(r.rent) || 0),
        fee: Math.max(0, Number(r.fee) || 0),
      }));
    data.unitMix = rows.length > 0 ? JSON.stringify(rows) : null;
  }
  if (b.manualOpex && typeof b.manualOpex === "object") {
    data.manualOpex = JSON.stringify(b.manualOpex);
  }
  // Itemized other income; otherIncomeMonthly stays the engine-facing total.
  if (Array.isArray(b.otherIncomeItems)) {
    const items = b.otherIncomeItems
      .filter((r: unknown) => r && typeof r === "object")
      .slice(0, 20)
      .map((r: Record<string, unknown>) => ({
        label: typeof r.label === "string" ? r.label.slice(0, 60) : "",
        monthly: Math.max(0, Number(r.monthly) || 0),
      }))
      .filter((r: { label: string; monthly: number }) => r.label || r.monthly > 0);
    data.otherIncomeItems = items.length > 0 ? JSON.stringify(items) : null;
    data.otherIncomeMonthly = items.length > 0
      ? items.reduce((s: number, r: { monthly: number }) => s + r.monthly, 0)
      : null;
  }
  // incomeBasis was retired by the classification-dictionary restructure: the
  // income convention is now always base rent − reductions + other income.

  const updated = await prisma.analysis.update({ where: { id }, data, include: { documents: true } });
  const extraction = parseExtraction(updated);
  const opts = await metricsOptions(userId);
  const metrics = computeMetrics(updated, extraction, opts);
  const metricsManual = computeMetrics(updated, extraction, { ...opts, source: "manual" });
  const metricsDocuments = computeMetrics(updated, extraction, { ...opts, source: "documents" });
  const aiSummary = updated.aiSummary ? JSON.parse(updated.aiSummary) : null;
  return NextResponse.json({
    ...updated,
    extractionParsed: extraction,
    metrics,
    metricsManual,
    metricsDocuments,
    aiSummaryParsed: aiSummary,
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.analysis.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.analysis.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
