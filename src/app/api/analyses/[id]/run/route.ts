import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { aiConfigured, extractFromDocuments, generateSummary } from "@/lib/ai";
import { computeMetrics, parseExtraction, parseCapRateBands } from "@/lib/metrics";
import { getOrCreateSettings } from "@/lib/settings";
import { consumeCreditForRun, recordAiRun } from "@/lib/billing";

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

  // mode=documents (default): AI reads the uploaded documents, then summarizes.
  // mode=manual: AI summarizes the user's deal-calculator inputs — no documents needed.
  const mode = new URL(request.url).searchParams.get("mode") === "manual" ? "manual" : "documents";

  if (mode === "documents") {
    const hasRentRoll = analysis.documents.some((d) => d.docType === "RENT_ROLL");
    const hasT12 = analysis.documents.some((d) => d.docType === "T12");
    if (!hasRentRoll || !hasT12) {
      return NextResponse.json(
        { error: "A Rent Roll and a T-12 Operating Statement are required before running the document analysis." },
        { status: 400 }
      );
    }
  }

  const creditError = await consumeCreditForRun(userId);
  if (creditError) {
    return NextResponse.json({ error: creditError }, { status: 402 });
  }

  await prisma.analysis.update({ where: { id }, data: { status: "ANALYZING" } });

  const settings = await getOrCreateSettings(userId);
  const metricsOpts = {
    capRateBands: parseCapRateBands(settings.capRateBands),
    whatIfRentDelta: settings.whatIfRentDelta,
  };

  try {
    // Step 1 (documents mode only): AI extraction from documents
    // (skippable via ?skipExtraction=1 when re-summarizing)
    const skipExtraction =
      new URL(request.url).searchParams.get("skipExtraction") === "1" && analysis.extraction;

    let extraction = mode === "documents" && !skipExtraction ? null : parseExtraction(analysis);
    if (mode === "documents" && !extraction) {
      const result = await extractFromDocuments(
        analysis.documents.map((d) => ({
          filename: d.filename,
          mimeType: d.mimeType,
          docType: d.docType,
          path: d.path,
        })),
        settings.aiModel
      );
      extraction = result.extraction;
      await recordAiRun({ userId, analysisId: id, mode: "extraction", ...result.usage });
      await prisma.analysis.update({
        where: { id },
        data: { extraction: JSON.stringify(extraction) },
      });
    }

    // Step 2: deterministic underwriting engine
    const fresh = await prisma.analysis.findUniqueOrThrow({ where: { id } });
    const metrics = computeMetrics(fresh, mode === "manual" ? null : extraction, {
      ...metricsOpts,
      source: mode === "manual" ? "manual" : "documents",
    });
    if (mode === "manual" && !metrics) {
      await prisma.analysis.update({ where: { id }, data: { status: analysis.status } });
      return NextResponse.json(
        { error: "Enter and save deal-calculator inputs (unit mix and/or operating costs) before running the manual AI analysis." },
        { status: 400 }
      );
    }

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
        dataSource:
          mode === "manual"
            ? "User-entered deal-calculator inputs (no documents analyzed). Note this basis and recommend verifying against actual rent roll and T-12 documents."
            : "AI-extracted from uploaded property documents.",
        extractedFinancials: mode === "manual" ? null : extraction,
        computedMetrics: metrics,
      },
      null,
      2
    );

    const { summary, usage: summaryUsage } = await generateSummary(context, settings.aiModel);
    await recordAiRun({ userId, analysisId: id, mode: "summary", ...summaryUsage });

    const needsReview =
      mode === "documents" &&
      (extraction?.dataFlags ?? []).some(
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
