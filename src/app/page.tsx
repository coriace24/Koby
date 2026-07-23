import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { computeMetrics, parseExtraction } from "@/lib/metrics";
import Header from "@/components/Header";
import StatusBadge from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const analyses = await prisma.analysis.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { documents: true } } },
  });

  const active = analyses.filter((a) => a.status !== "COMPLETED");
  const completed = analyses.filter((a) => a.status === "COMPLETED");

  // Portfolio snapshot across analyses that have computable metrics
  const withMetrics = analyses
    .map((a) => ({ a, m: computeMetrics(a, parseExtraction(a)) }))
    .filter((x) => x.m !== null);
  const totalUnits = analyses.reduce((s, a) => s + a.units, 0);
  const totalValue = analyses.reduce((s, a) => s + a.purchasePrice, 0);
  const avgCap =
    withMetrics.length > 0
      ? withMetrics.reduce((s, x) => s + (x.m!.base.capRate || 0), 0) / withMetrics.length
      : null;
  const totalCashFlow = withMetrics.reduce((s, x) => s + x.m!.base.cashFlowAfterDebtService, 0);

  return (
    <>
      <Header userName={user.name} />
      <main className="max-w-5xl mx-auto w-full px-6 py-8 flex-1">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-sm text-slate-500 mt-1">
              {active.length} active · {completed.length} completed
            </p>
          </div>
          <Link
            href="/analyses/new"
            className="rounded-md bg-blue-700 text-white px-4 py-2 text-sm font-medium hover:bg-blue-800"
          >
            + New property analysis
          </Link>
        </div>

        {analyses.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Deals under analysis</div>
              <div className="text-xl font-semibold">{analyses.length}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Total units</div>
              <div className="text-xl font-semibold">{totalUnits}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Combined offer value</div>
              <div className="text-xl font-semibold">{money(totalValue)}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">
                Avg cap rate{totalCashFlow !== 0 ? " · cash flow" : ""}
              </div>
              <div className="text-xl font-semibold">
                {avgCap !== null ? `${avgCap.toFixed(2)}%` : "—"}
                {withMetrics.length > 0 && (
                  <span className="text-sm font-normal text-slate-500"> · {money(totalCashFlow)}/yr</span>
                )}
              </div>
            </div>
          </div>
        )}

        {analyses.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <p className="text-slate-600 font-medium">No property analyses yet</p>
            <p className="text-sm text-slate-400 mt-1">
              Create your first analysis, upload a rent roll and T-12, and let the AI do the initial
              underwriting.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {analyses.map((a) => (
              <Link
                key={a.id}
                href={`/analyses/${a.id}`}
                className="bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="font-semibold truncate">{a.address}</div>
                  <div className="text-sm text-slate-500 mt-0.5">
                    {a.units} units · {money(a.purchasePrice)} · {a.propertyType} · Built {a.yearBuilt} ·{" "}
                    {a._count.documents} document{a._count.documents === 1 ? "" : "s"}
                  </div>
                </div>
                <StatusBadge status={a.status} />
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
