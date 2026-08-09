import { prisma } from "@/lib/db";
import { computeMetrics, parseExtraction, parseCapRateBands } from "@/lib/metrics";
import { getOrCreateSettings } from "@/lib/settings";
import { brandingContactLines } from "@/lib/report";
import type { AiSummary } from "@/lib/ai";

export const dynamic = "force-dynamic";

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined ? "—" : `${n.toFixed(d)}%`;

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await prisma.shareLink.findUnique({
    where: { id: token },
    include: { analysis: true },
  });

  if (!link || link.revokedAt) {
    return (
      <main className="max-w-2xl mx-auto px-6 py-16 text-center">
        <h1 className="text-xl font-semibold text-slate-700">This link is not available</h1>
        <p className="text-sm text-slate-500 mt-2">
          The share link does not exist or has been revoked by its owner.
        </p>
      </main>
    );
  }

  const a = link.analysis;
  const settings = await getOrCreateSettings(a.userId);
  const extraction = parseExtraction(a);
  const m = computeMetrics(a, extraction, {
    capRateBands: parseCapRateBands(settings.capRateBands),
    whatIfRentDelta: settings.whatIfRentDelta,
  });
  const ai: AiSummary | null = a.aiSummary ? JSON.parse(a.aiSummary) : null;
  const brand = settings.companyName?.trim() || "Investment Analysis";

  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10 space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-wide text-blue-900 uppercase">{brand}</div>
        {brandingContactLines(settings).map((line, i) => (
          <div key={i} className="text-xs text-slate-500">
            {line}
          </div>
        ))}
        <h1 className="text-2xl font-bold mt-2">{a.address}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {a.units} units · {money(a.purchasePrice)} · {a.propertyType} · Built {a.yearBuilt}
        </p>
        <a
          href={`/api/share/${token}/report`}
          className="inline-block mt-3 rounded-md bg-blue-700 text-white px-4 py-2 text-sm font-medium hover:bg-blue-800"
        >
          Download PDF report
        </a>
      </div>

      {m && (
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="font-semibold mb-4">Key metrics</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {[
              ["NOI (annual)", money(m.base.noi)],
              ["Cap rate", pct(m.base.capRate)],
              ["DSCR", m.base.dscr ? m.base.dscr.toFixed(2) : "—"],
              ["Cash-on-cash", pct(m.base.cashOnCashReturn)],
              ["Total cash needed", money(m.cashNeeded.total)],
              ["Cash flow after debt", money(m.base.cashFlowAfterDebtService)],
              ["Break-even occupancy", pct(m.base.breakEvenOccupancy, 1)],
              ...(m.projection
                ? ([
                    ["IRR (projected)", pct(m.projection.irrPct)],
                  ] as [string, string][])
                : []),
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="text-lg font-semibold">{value}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {ai && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 text-sm leading-relaxed">
          <div>
            <h2 className="font-semibold mb-1">Overview</h2>
            <p>{ai.overview}</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <h3 className="font-medium text-green-700 mb-1">Opportunities</h3>
              <ul className="list-disc pl-5 space-y-1">
                {ai.opportunities.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-medium text-orange-700 mb-1">Risks to investigate</h3>
              <ul className="list-disc pl-5 space-y-1">
                {ai.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      <p className="text-xs text-slate-400 pb-8">
        Prepared with AI assistance for informational purposes only. All figures should be independently
        verified before any investment decision. This page is a read-only shared view.
      </p>
    </main>
  );
}
