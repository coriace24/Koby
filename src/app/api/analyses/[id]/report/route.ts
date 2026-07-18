import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { computeMetrics, parseExtraction } from "@/lib/metrics";
import type { AiSummary } from "@/lib/ai";

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? "—" : `${n.toFixed(digits)}%`;
const ratio = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(2));

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const analysis = await prisma.analysis.findFirst({ where: { id, userId } });
  if (!analysis) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const extraction = parseExtraction(analysis);
  const metrics = computeMetrics(analysis, extraction);
  const summary: AiSummary | null = analysis.aiSummary ? JSON.parse(analysis.aiSummary) : null;

  const doc = new PDFDocument({ size: "LETTER", margins: { top: 54, bottom: 54, left: 54, right: 54 } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const heading = (text: string) => {
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#1a365d").text(text);
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10).fillColor("#000000");
  };
  const kv = (label: string, value: string) => {
    doc.font("Helvetica-Bold").text(`${label}: `, { continued: true }).font("Helvetica").text(value);
  };
  const bullets = (items: string[]) => {
    for (const item of items) doc.text(`•  ${item}`, { indent: 10 });
  };

  // Header
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#1a365d").text("Investment Analysis Summary");
  doc.font("Helvetica").fontSize(10).fillColor("#555555").text(`Generated ${new Date().toLocaleDateString("en-US")} · Koby AI Underwriting Assistant`);
  doc.moveDown(0.5);
  doc.moveTo(54, doc.y).lineTo(558, doc.y).strokeColor("#1a365d").stroke();
  doc.fillColor("#000000").fontSize(10);

  heading("Property Overview");
  kv("Property", analysis.address);
  kv("Property Type", analysis.propertyType);
  kv("Purchase Price", money(analysis.purchasePrice));
  kv("Units", String(analysis.units));
  kv("Year Built", String(analysis.yearBuilt));
  kv("Stated Occupancy", pct(analysis.occupancy, 1));
  if (analysis.strategy) kv("Strategy", analysis.strategy);

  if (metrics) {
    heading("Underwriting Results");
    kv("Effective Gross Income", money(metrics.base.effectiveGrossIncome));
    kv("Operating Expenses", money(metrics.base.totalOperatingExpenses));
    kv("Net Operating Income (NOI)", money(metrics.base.noi));
    kv("Cap Rate", pct(metrics.base.capRate));
    kv("Annual Debt Service", money(metrics.base.annualDebtService));
    kv("DSCR", ratio(metrics.base.dscr));
    kv("Cash Flow After Debt Service", money(metrics.base.cashFlowAfterDebtService));
    kv("Equity Requirement", money(metrics.base.equityRequirement));
    kv("Cash-on-Cash Return", pct(metrics.base.cashOnCashReturn));
    kv("Break-even Occupancy", pct(metrics.base.breakEvenOccupancy, 1));
    if (metrics.stabilized) {
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").text("Stabilized (Value-Add) Projection");
      kv("Stabilized NOI", money(metrics.stabilized.stabilizedNoi));
      kv("Stabilized Cap Rate", pct(metrics.stabilized.stabilizedCapRate));
      kv("Stabilized Cash Flow", money(metrics.stabilized.stabilizedCashFlow));
      kv("Stabilized Cash-on-Cash", pct(metrics.stabilized.stabilizedCashOnCash));
    }
    if (metrics.rentGrowth) {
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").text("Rent Growth Analysis");
      kv("Current Avg Rent", `${money(metrics.rentGrowth.currentAvgRent)}/unit/month`);
      kv("Assumed Market Rent", `${money(metrics.rentGrowth.marketRent)}/unit/month`);
      kv("Potential Increase", `${money(metrics.rentGrowth.perUnitMonthlyIncrease)}/unit/month`);
      kv("Annual Revenue Increase", money(metrics.rentGrowth.annualRevenueIncrease));
    }
    if (metrics.renovation) {
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").text("Renovation Analysis");
      kv("Total Renovation Investment", money(metrics.renovation.totalInvestment));
      kv("Additional Annual Income", money(metrics.renovation.additionalAnnualIncome));
      kv("Return on Renovation", pct(metrics.renovation.returnOnRenovation));
      kv("Value Impact at Exit Cap", money(metrics.renovation.valueImpactAtExitCap));
    }
  }

  if (summary) {
    heading("Analysis Overview");
    doc.text(summary.overview, { align: "justify" });

    heading("Opportunities");
    bullets(summary.opportunities);

    heading("Risks");
    bullets(summary.risks);

    heading("Key Assumptions");
    bullets(summary.assumptionNotes);

    heading("Analysis Summary");
    doc.text(summary.summary, { align: "justify" });
  }

  if (extraction && extraction.dataFlags.length > 0) {
    heading("Data Quality Flags");
    bullets(extraction.dataFlags.map((f) => `[${f.severity.toUpperCase()}] ${f.message}`));
  }

  doc.moveDown(1);
  doc.fontSize(8).fillColor("#777777").text(
    "This report was generated with AI assistance and is provided for informational purposes only. All AI-generated information must be reviewed and verified by a qualified professional before being used for investment decisions, investor presentations, or acquisitions. This report does not constitute investment, financial, or appraisal advice.",
    { align: "justify" }
  );

  doc.end();
  const pdf = await done;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="analysis-${analysis.id}.pdf"`,
    },
  });
}
