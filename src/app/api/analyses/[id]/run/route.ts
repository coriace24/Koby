import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { aiConfigured, extractFromDocuments, generateSummary } from "@/lib/ai";
import { computeMetrics, parseExtraction } from "@/lib/metrics";

export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const analysis = await prisma.analysis.findFirst({
    where: { id, userId },
    include: { documents: true },
  });
  if (!analysis) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server. Add it to .env to enable AI analysis." },
      { status: 503 }
    );
  }

  const hasRentRoll = analysis.documents.some((d) => d.docType === "RENT_ROLL");
  const hasT12 = analysis.documents.some((d) => d.docType === "T12");
  if (!hasRentRoll || !hasT12) {
    return NextResponse.json(
      { error: "A Rent Roll and a T-12 Operating Statement are required before running the analysis." },
      { status: 400 }
    );
  }

  await prisma.analysis.update({ where: { id }, data: { status: "ANALYZING" } });

  try {
    // Step 1: AI extraction from documents (skippable via ?skipExtraction=1 when re-summarizing)
    const skipExtraction =
      new URL(request.url).searchParams.get("skipExtraction") === "1" && analysis.extraction;

    let extraction = skipExtraction ? parseExtraction(analysis) : null;
    if (!extraction) {
      extraction = await extractFromDocuments(
        analysis.documents.map((d) => ({
          filename: d.filename,
          mimeType: d.mimeType,
          docType: d.docType,
          path: d.path,
        }))
      );
      await prisma.analysis.update({
        where: { id },
        data: { extraction: JSON.stringify(extraction) },
      });
    }

    // Step 2: deterministic underwriting engine
    const fresh = await prisma.analysis.findUniqueOrThrow({ where: { id } });
    const metrics = computeMetrics(fresh, extraction);

    // Step 3: AI summary grounded in the computed figures
    const context = JSON.stringify(
      {
        property: {
          address: fresh.address,
          purchasePrice: fresh.purchasePrice,
          units: fresh.units,
          propertyType: fresh.propertyType,
          yearBuilt: fresh.yearBuilt,
          statedOccupancyPct: fresh.occupancy,
          strategy: fresh.strategy,
          targetCashOnCashPct: fresh.targetReturn,
          notes: fresh.notes,
        },
        financing: {
          loanAmount: fresh.loanAmount,
          interestRatePct: fresh.interestRate,
          loanTermYears: fresh.loanTermYears,
          downPayment: fresh.downPayment,
          renovationBudget: fresh.renovationBudget,
        },
        assumptions: {
          marketRentPerUnitMonthly: fresh.marketRentPerUnit,
          renovationCostPerUnit: fresh.renoCostPerUnit,
          renovatedUnitCount: fresh.renoUnitCount,
          renovationRentIncreaseMonthly: fresh.renoRentIncrease,
          exitCapRatePct: fresh.exitCapRate,
          vacancyAssumptionPct: fresh.vacancyAssumption ?? 5,
        },
        extractedFinancials: extraction,
        computedMetrics: metrics,
      },
      null,
      2
    );

    const summary = await generateSummary(context);

    const needsReview = extraction.dataFlags.some(
      (f) => f.severity === "warning" || f.severity === "critical"
    );

    const updated = await prisma.analysis.update({
      where: { id },
      data: {
        aiSummary: JSON.stringify(summary),
        status: needsReview ? "NEEDS_REVIEW" : "COMPLETED",
      },
      include: { documents: true },
    });

    return NextResponse.json({
      ...updated,
      extractionParsed: extraction,
      metrics,
      aiSummaryParsed: summary,
    });
  } catch (err) {
    await prisma.analysis.update({ where: { id }, data: { status: "FAILED" } });
    const message = err instanceof Error ? err.message : "AI analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
