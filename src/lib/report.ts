// Branded PDF investment summary, shared by the authenticated report route and
// public share links.
import PDFDocument from "pdfkit";
import type { Analysis } from "@prisma/client";
import type { AiSummary, Extraction } from "./ai";
import type { FullMetrics } from "./metrics";
import { BELOW_NOI_LABELS } from "./underwriting";

export interface ReportBranding {
  companyName?: string | null;
  companyContact?: string | null; // tagline / extra line
  companyPhone?: string | null;
  companyEmail?: string | null;
  companyWebsite?: string | null;
  companyAddress?: string | null;
  companyLicense?: string | null;
  brandColor?: string | null; // hex
}

// "phone · email · website" style line from whichever fields are filled in.
export function brandingContactLines(b: ReportBranding): string[] {
  const lines: string[] = [];
  const contact = [b.companyPhone, b.companyEmail, b.companyWebsite]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(" · ");
  if (contact) lines.push(contact);
  const office = [b.companyAddress, b.companyLicense]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(" · ");
  if (office) lines.push(office);
  if (b.companyContact?.trim()) lines.push(b.companyContact.trim());
  return lines;
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? "—" : `${n.toFixed(digits)}%`;
const ratio = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(2));

function sanitizeColor(hex: string | null | undefined, fallback: string): string {
  return hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : fallback;
}

export function buildReportPdf(
  analysis: Analysis,
  metrics: FullMetrics | null,
  extraction: Extraction | null,
  summary: AiSummary | null,
  branding: ReportBranding
): Promise<Buffer> {
  const accent = sanitizeColor(branding.brandColor, "#1a365d");
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 54, bottom: 54, left: 54, right: 54 } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const heading = (text: string) => {
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(14).fillColor(accent).text(text);
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
  const brandLine = branding.companyName?.trim() || "Koby AI Underwriting Assistant";
  doc.font("Helvetica-Bold").fontSize(11).fillColor(accent).text(brandLine.toUpperCase());
  for (const line of brandingContactLines(branding)) {
    doc.font("Helvetica").fontSize(9).fillColor("#555555").text(line);
  }
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(20).fillColor(accent).text("Investment Analysis Summary");
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#555555")
    .text(`${analysis.address} · Generated ${new Date().toLocaleDateString("en-US")}`);
  doc.moveDown(0.5);
  doc.moveTo(54, doc.y).lineTo(558, doc.y).strokeColor(accent).stroke();
  doc.fillColor("#000000").fontSize(10);

  heading("Property Overview");
  kv("Property", analysis.address);
  kv("Property Type", analysis.propertyType);
  kv("Units", String(analysis.units));
  kv("Year Built", String(analysis.yearBuilt));
  kv("Stated Occupancy", pct(analysis.occupancy, 1));
  if (analysis.strategy) kv("Strategy", analysis.strategy);

  if (metrics) {
    heading("Acquisition & Cash Needed");
    if (analysis.askingPrice) kv("Asking Price", money(analysis.askingPrice));
    kv("Offer / Purchase Price", money(analysis.purchasePrice));
    if (metrics.pricePerUnit) kv("Price per Unit", money(metrics.pricePerUnit));
    kv("Down Payment", money(metrics.cashNeeded.downPayment));
    kv("Closing Costs", money(metrics.cashNeeded.closingCosts));
    kv("Carrying Costs", money(metrics.cashNeeded.carryingCosts));
    kv("Renovation Budget", money(metrics.cashNeeded.renovationBudget));
    kv("Total Cash Needed", money(metrics.cashNeeded.total));

    heading("Underwriting Results");
    if (metrics.dataSource === "manual") {
      doc
        .font("Helvetica-Oblique")
        .text("Figures below are based on manually entered deal-calculator inputs (no documents analyzed).");
      doc.font("Helvetica");
    }
    kv("Effective Gross Income", money(metrics.base.effectiveGrossIncome));
    kv("Operating Expenses", money(metrics.base.totalOperatingExpenses));
    kv("Net Operating Income (NOI)", money(metrics.base.noi));
    kv("Cap Rate", pct(metrics.base.capRate));
    kv("Annual Debt Service", money(metrics.base.annualDebtService));
    kv("DSCR", ratio(metrics.base.dscr));
    kv("Cash Flow After Debt Service", money(metrics.base.cashFlowAfterDebtService));
    kv("Cash-on-Cash Return", pct(metrics.base.cashOnCashReturn));
    kv("Break-even Occupancy", pct(metrics.base.breakEvenOccupancy, 1));

    // Below-NOI items found in the documents — shown so readers see the
    // exclusions were deliberate, per the classification dictionary.
    if (extraction) {
      const belowNoiLabels: Record<string, string> = BELOW_NOI_LABELS;
      const belowNoi = Object.entries(extraction.belowNoi ?? {}).filter(
        ([, it]) => it && it.annualAmount !== 0
      );
      if (belowNoi.length > 0) {
        doc.moveDown(0.4);
        doc.font("Helvetica-Bold").text("Below NOI — Excluded from Operating Results");
        doc
          .font("Helvetica-Oblique")
          .fontSize(9)
          .text(
            "The following items were found in the documents but are capital/financing items, not operating expenses. They are reported for completeness and deliberately excluded from NOI."
          );
        doc.font("Helvetica").fontSize(10);
        for (const [key, it] of belowNoi) {
          kv(belowNoiLabels[key] ?? key, money(it.annualAmount));
        }
      }
    }

    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").text("Valuation at Selected Cap Rates");
    for (const row of metrics.capRateMatrix) {
      const vs =
        row.vsAsking !== null
          ? ` (${row.vsAsking >= 0 ? "+" : ""}${money(row.vsAsking)} vs asking)`
          : ` (${row.vsOffer >= 0 ? "+" : ""}${money(row.vsOffer)} vs offer)`;
      kv(`Value at ${row.capRatePct.toFixed(1)}% cap`, money(row.impliedValue) + vs);
    }

    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").text("Rent Sensitivity (What If?)");
    for (const s of metrics.sensitivity) {
      const label =
        s.monthlyRentDelta === 0
          ? "Base"
          : `${s.monthlyRentDelta > 0 ? "+" : ""}${money(s.monthlyRentDelta)}/mo`;
      kv(label, `${money(s.annualCashFlow)} cash flow · ${pct(s.cashOnCash)} CoC`);
    }

    if (metrics.projection) {
      const p = metrics.projection;
      heading(`Hold-Period Returns (${p.years.length}-Year Hold)`);
      kv("Assumptions", `${pct(analysis.rentGrowthPct ?? 2, 1)} income growth · ${pct(analysis.expenseGrowthPct ?? 2, 1)} expense growth · exit at ${pct(analysis.exitCapRate, 1)} cap · ${pct(analysis.saleCostPct ?? 5, 1)} sale costs`);
      kv("Projected Sale Price", money(p.salePrice));
      kv("Loan Balance at Exit", money(p.loanBalanceAtExit));
      kv("Net Sale Proceeds", money(p.netSaleProceeds));
      kv("Total Operating Cash Flow", money(p.totalCashFlow));
      kv("Total Profit", money(p.totalProfit));
      kv("Equity Multiple", p.equityMultiple ? `${p.equityMultiple.toFixed(2)}x` : "—");
      kv("IRR", pct(p.irrPct));
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").fontSize(9).text("Year    NOI            Debt Service     Cash Flow");
      doc.font("Helvetica").fontSize(9);
      for (const y of p.years) {
        doc.text(
          `${String(y.year).padEnd(8)}${money(y.noi).padEnd(15)}${money(y.debtService).padEnd(17)}${money(y.cashFlow)}`
        );
      }
      doc.fontSize(10);
    }

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
  doc
    .fontSize(8)
    .fillColor("#777777")
    .text(
      "This report was generated with AI assistance and is provided for informational purposes only. All AI-generated information must be reviewed and verified by a qualified professional before being used for investment decisions, investor presentations, or acquisitions. This report does not constitute investment, financial, or appraisal advice.",
      { align: "justify" }
    );

  doc.end();
  return done;
}
