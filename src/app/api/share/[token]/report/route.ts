import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeMetrics, parseExtraction, parseCapRateBands } from "@/lib/metrics";
import { getOrCreateSettings } from "@/lib/settings";
import { buildReportPdf } from "@/lib/report";
import type { AiSummary } from "@/lib/ai";

// Public: PDF report behind an unguessable share token.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await prisma.shareLink.findUnique({
    where: { id: token },
    include: { analysis: true },
  });
  if (!link || link.revokedAt) {
    return NextResponse.json({ error: "This share link does not exist or was revoked." }, { status: 404 });
  }

  const analysis = link.analysis;
  const settings = await getOrCreateSettings(analysis.userId);
  const extraction = parseExtraction(analysis);
  const metrics = computeMetrics(analysis, extraction, {
    capRateBands: parseCapRateBands(settings.capRateBands),
    whatIfRentDelta: settings.whatIfRentDelta,
  });
  const summary: AiSummary | null = analysis.aiSummary ? JSON.parse(analysis.aiSummary) : null;

  const pdf = await buildReportPdf(analysis, metrics, extraction, summary, settings);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="investment-summary.pdf"`,
    },
  });
}
