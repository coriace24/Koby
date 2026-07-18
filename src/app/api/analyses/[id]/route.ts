import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { computeMetrics, parseExtraction } from "@/lib/metrics";

async function getOwnedAnalysis(id: string, userId: string) {
  return prisma.analysis.findFirst({ where: { id, userId }, include: { documents: true } });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const analysis = await getOwnedAnalysis(id, userId);
  if (!analysis) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const extraction = parseExtraction(analysis);
  const metrics = computeMetrics(analysis, extraction);
  const aiSummary = analysis.aiSummary ? JSON.parse(analysis.aiSummary) : null;

  return NextResponse.json({ ...analysis, extractionParsed: extraction, metrics, aiSummaryParsed: aiSummary });
}

const EDITABLE_NUMERIC = [
  "purchasePrice", "units", "yearBuilt", "occupancy",
  "loanAmount", "interestRate", "loanTermYears", "downPayment",
  "renovationBudget", "targetReturn",
  "marketRentPerUnit", "renoCostPerUnit", "renoUnitCount", "renoRentIncrease",
  "exitCapRate", "vacancyAssumption",
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
          data[key] = ["units", "yearBuilt", "loanTermYears", "renoUnitCount"].includes(key)
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

  const updated = await prisma.analysis.update({ where: { id }, data, include: { documents: true } });
  const extraction = parseExtraction(updated);
  const metrics = computeMetrics(updated, extraction);
  const aiSummary = updated.aiSummary ? JSON.parse(updated.aiSummary) : null;
  return NextResponse.json({ ...updated, extractionParsed: extraction, metrics, aiSummaryParsed: aiSummary });
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
