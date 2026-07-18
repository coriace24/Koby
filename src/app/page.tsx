import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
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
