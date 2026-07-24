"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import StatusBadge from "./StatusBadge";
import PageShell from "./PageShell";

// ---------- Types mirrored from the API ----------

interface LineItem {
  annualAmount: number;
  source: string;
}
interface Extraction {
  income: Record<string, LineItem>;
  expenses: Record<string, LineItem>;
  rentRoll: { unitCount: number; averageRentPerUnit: number; occupancyPct: number };
  dataFlags: { severity: string; message: string }[];
}
interface UnitMixRow {
  label: string;
  count: number;
  rent: number;
  fee: number;
}
interface Metrics {
  dataSource: "documents" | "manual";
  cashNeeded: {
    downPayment: number;
    closingCosts: number;
    carryingCosts: number;
    renovationBudget: number;
    total: number;
  };
  capRateMatrix: {
    capRatePct: number;
    impliedValue: number;
    vsAsking: number | null;
    vsOffer: number;
  }[];
  sensitivity: {
    monthlyRentDelta: number;
    effectiveMonthlyIncome: number;
    annualCashFlow: number;
    cashOnCash: number | null;
  }[];
  pricePerUnit: number | null;
  askingPricePerUnit: number | null;
  base: {
    effectiveGrossIncome: number;
    totalOperatingExpenses: number;
    noi: number;
    capRate: number;
    monthlyDebtService: number;
    annualDebtService: number;
    dscr: number | null;
    cashFlowAfterDebtService: number;
    equityRequirement: number;
    cashOnCashReturn: number | null;
    expenseRatio: number | null;
    breakEvenOccupancy: number | null;
  };
  rentGrowth: {
    currentAvgRent: number;
    marketRent: number;
    perUnitMonthlyIncrease: number;
    annualRevenueIncrease: number;
  } | null;
  renovation: {
    totalInvestment: number;
    additionalAnnualIncome: number;
    returnOnRenovation: number | null;
    valueImpactAtExitCap: number | null;
  } | null;
  stabilized: {
    stabilizedNoi: number;
    stabilizedCapRate: number;
    stabilizedCashFlow: number;
    stabilizedCashOnCash: number | null;
  } | null;
}
interface AiSummary {
  overview: string;
  opportunities: string[];
  risks: string[];
  assumptionNotes: string[];
  summary: string;
}
interface Doc {
  id: string;
  filename: string;
  docType: string;
  size: number;
}
interface AnalysisData {
  id: string;
  address: string;
  propertyType: string;
  purchasePrice: number;
  askingPrice: number | null;
  closingCosts: number | null;
  carryingCosts: number | null;
  otherIncomeMonthly: number | null;
  unitMix: string | null;
  manualOpex: string | null;
  units: number;
  yearBuilt: number;
  occupancy: number;
  loanAmount: number;
  interestRate: number;
  loanTermYears: number;
  downPayment: number;
  renovationBudget: number | null;
  targetReturn: number | null;
  strategy: string | null;
  notes: string | null;
  marketRentPerUnit: number | null;
  renoCostPerUnit: number | null;
  renoUnitCount: number | null;
  renoRentIncrease: number | null;
  exitCapRate: number | null;
  vacancyAssumption: number | null;
  status: string;
  documents: Doc[];
  extractionParsed: Extraction | null;
  metrics: Metrics | null;
  metricsManual: Metrics | null;
  metricsDocuments: Metrics | null;
  aiSummaryParsed: AiSummary | null;
}

// ---------- Formatting helpers ----------

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined ? "—" : `${n.toFixed(d)}%`;
const ratio = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(2));

const INCOME_LABELS: Record<string, string> = {
  grossPotentialRent: "Gross potential rent",
  actualCollectedRent: "Actual collected rent",
  vacancyLoss: "Vacancy loss",
  otherIncome: "Other income",
};
const EXPENSE_LABELS: Record<string, string> = {
  propertyTaxes: "Property taxes",
  insurance: "Insurance",
  utilities: "Utilities",
  repairsMaintenance: "Repairs & maintenance",
  managementFees: "Management fees",
  payroll: "Payroll",
  landscaping: "Landscaping",
  administrative: "Administrative",
  other: "Other operating expenses",
};
const DOC_TYPES: [string, string][] = [
  ["RENT_ROLL", "Rent Roll (required)"],
  ["T12", "T-12 Operating Statement (required)"],
  ["OFFERING_MEMO", "Offering Memorandum"],
  ["TAX", "Property tax records"],
  ["INSURANCE", "Insurance information"],
  ["UTILITY", "Utility statements"],
  ["LEASE", "Lease information"],
  ["FINANCIAL", "Financial statements"],
  ["OTHER", "Other"],
];

const card = "bg-white border border-slate-200 rounded-xl p-6";
const inputCls =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-semibold ${accent ? "text-blue-800" : ""}`}>{value}</div>
    </div>
  );
}

const OPEX_FIELDS: [string, string][] = [
  ["propertyTaxes", "Property taxes"],
  ["insurance", "Insurance"],
  ["utilities", "Utilities"],
  ["repairsMaintenance", "Repairs / maint / turns"],
  ["managementFees", "Management fees"],
  ["payroll", "Payroll"],
  ["landscaping", "Landscaping / CAM"],
  ["administrative", "Administrative"],
  ["other", "Misc / cap-ex holdback"],
];

export default function AnalysisDetail({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<AnalysisData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingAssumptions, setSavingAssumptions] = useState(false);
  const [mixRows, setMixRows] = useState<UnitMixRow[]>([]);
  const [savingCalc, setSavingCalc] = useState(false);
  const [tab, setTab] = useState<"manual" | "documents">("manual");
  const tabInitialized = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const docTypeRef = useRef<HTMLSelectElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/analyses/${id}`);
    if (res.ok) {
      const d: AnalysisData = await res.json();
      setData(d);
      if (!tabInitialized.current) {
        tabInitialized.current = true;
        setTab(d.extractionParsed || d.documents.length > 0 ? "documents" : "manual");
      }
      try {
        setMixRows(d.unitMix ? JSON.parse(d.unitMix) : []);
      } catch {
        setMixRows([]);
      }
    } else if (res.status === 404) {
      setError("Analysis not found.");
    } else {
      setError("Failed to load analysis.");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveCalculator(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavingCalc(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const manualOpex: Record<string, number> = {};
    for (const [key] of OPEX_FIELDS) {
      manualOpex[key] = parseFloat(String(fd.get(`opex_${key}`) || "0")) || 0;
    }
    const body = {
      unitMix: mixRows.filter((r) => r.count > 0 || r.rent > 0 || r.label),
      manualOpex,
      otherIncomeMonthly: fd.get("otherIncomeMonthly") || null,
    };
    const res = await fetch(`/api/analyses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const d = await res.json();
      setData(d);
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to save calculator inputs.");
    }
    setSavingCalc(false);
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("docType", docTypeRef.current?.value ?? "OTHER");
    const res = await fetch(`/api/analyses/${id}/documents`, { method: "POST", body: fd });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Upload failed.");
    } else if (fileRef.current) {
      fileRef.current.value = "";
    }
    setUploading(false);
    await load();
  }

  async function removeDoc(docId: string) {
    await fetch(`/api/analyses/${id}/documents?docId=${docId}`, { method: "DELETE" });
    await load();
  }

  async function runAnalysis(mode: "manual" | "documents") {
    setRunning(true);
    setError(null);
    const res = await fetch(`/api/analyses/${id}/run?mode=${mode}`, { method: "POST" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Analysis failed.");
    }
    setRunning(false);
    await load();
  }

  async function saveAssumptions(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavingAssumptions(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, string | null> = {};
    fd.forEach((v, k) => {
      body[k] = v === "" ? null : String(v);
    });
    const res = await fetch(`/api/analyses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setData(await res.json());
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to save assumptions.");
    }
    setSavingAssumptions(false);
  }

  async function overrideLineItem(section: "income" | "expenses", key: string, current: number) {
    if (!data?.extractionParsed) return;
    const raw = window.prompt(
      `Override annual amount for "${(section === "income" ? INCOME_LABELS : EXPENSE_LABELS)[key]}" (currently ${money(current)}):`,
      String(current)
    );
    if (raw === null) return;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return;
    const extraction = structuredClone(data.extractionParsed);
    extraction[section][key] = { annualAmount: n, source: "User override" };
    const res = await fetch(`/api/analyses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraction }),
    });
    if (res.ok) setData(await res.json());
  }

  async function deleteAnalysis() {
    if (!window.confirm("Delete this analysis and its documents?")) return;
    await fetch(`/api/analyses/${id}`, { method: "DELETE" });
    router.push("/");
  }

  if (error && !data) {
    return (
      <main className="max-w-5xl mx-auto w-full px-6 py-8">
        <p className="text-red-600">{error}</p>
        <Link href="/" className="text-blue-700 hover:underline text-sm">
          ← Back to dashboard
        </Link>
      </main>
    );
  }
  if (!data) {
    return <main className="max-w-5xl mx-auto w-full px-6 py-8 text-slate-500">Loading…</main>;
  }

  const hasRentRoll = data.documents.some((d) => d.docType === "RENT_ROLL");
  const hasT12 = data.documents.some((d) => d.docType === "T12");
  const m = tab === "manual" ? data.metricsManual : data.metricsDocuments;
  const ai = data.aiSummaryParsed;
  const ex = data.extractionParsed;
  let manualOpexDefaults: Record<string, number> = {};
  try {
    manualOpexDefaults = data.manualOpex ? JSON.parse(data.manualOpex) : {};
  } catch {
    manualOpexDefaults = {};
  }
  const mixMonthlyTotal = mixRows.reduce(
    (sum, r) => sum + (r.count || 0) * ((r.rent || 0) + (r.fee || 0)),
    0
  );

  return (
    <PageShell>
    <main className="max-w-5xl mx-auto w-full px-6 py-8 flex-1 space-y-6">
      <div>
        <Link href="/" className="text-sm text-blue-700 hover:underline">
          ← Back to dashboard
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
          <div>
            <h1 className="text-2xl font-bold">{data.address}</h1>
            <p className="text-sm text-slate-500 mt-1">
              {data.units} units · {money(data.purchasePrice)} · {data.propertyType} · Built {data.yearBuilt} ·{" "}
              {pct(data.occupancy, 1)} occupied
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={data.status} />
            <a
              href={`/api/analyses/${id}/report`}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Export PDF report
            </a>
            <button onClick={deleteAnalysis} className="text-sm text-red-600 hover:underline">
              Delete
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>}

      {/* Data-source tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            ["manual", "Manual entry"],
            ["documents", "Uploaded documents"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`px-4 py-2 text-sm rounded-t-lg border border-b-0 -mb-px ${
              tab === value
                ? "bg-white border-slate-200 font-semibold text-blue-800"
                : "bg-transparent border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
            {value === "documents" && data.documents.length > 0 && (
              <span className="ml-1.5 text-xs text-slate-400">({data.documents.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Documents */}
      {tab === "documents" && (
      <section className={card}>
        <h2 className="font-semibold mb-1">Property documents</h2>
        <p className="text-xs text-slate-500 mb-4">
          Rent Roll and T-12 Operating Statement are required. PDF, Excel, and CSV supported (max 30 MB).
        </p>
        {data.documents.length > 0 && (
          <ul className="divide-y divide-slate-100 mb-4">
            {data.documents.map((d) => (
              <li key={d.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <span className="font-medium truncate">{d.filename}</span>
                  <span className="ml-2 text-xs text-slate-400">
                    {DOC_TYPES.find(([v]) => v === d.docType)?.[1] ?? d.docType} · {(d.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                <button onClick={() => removeDoc(d.id)} className="text-xs text-red-600 hover:underline shrink-0">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={upload} className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="text-sm" required />
          <select ref={docTypeRef} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            {DOC_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={uploading}
            className="rounded-md bg-slate-800 text-white px-4 py-1.5 text-sm hover:bg-slate-900 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={() => runAnalysis("documents")}
            disabled={running || !hasRentRoll || !hasT12}
            className="rounded-md bg-blue-700 text-white px-5 py-2 text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
          >
            {running ? "AI reviewing documents… (this can take a few minutes)" : ex ? "Re-run AI analysis" : "Run AI analysis"}
          </button>
          {(!hasRentRoll || !hasT12) && (
            <span className="text-xs text-slate-500">
              Upload {!hasRentRoll && "a Rent Roll"}
              {!hasRentRoll && !hasT12 && " and "}
              {!hasT12 && "a T-12 Operating Statement"} to enable analysis.
            </span>
          )}
        </div>
      </section>
      )}

      {/* Deal calculator (manual mode) */}
      {tab === "manual" && (
      <section className={card}>
        <h2 className="font-semibold mb-1">Deal calculator</h2>
        <p className="text-xs text-slate-500 mb-4">
          Instant underwriting without documents: build the rent from your unit mix and estimate annual
          operating costs. Metrics update on save; the AI can then write its analysis from these inputs.
        </p>
        <form onSubmit={saveCalculator}>
          <h3 className="text-sm font-medium text-slate-500 mb-2">Unit mix & rents ($/month)</h3>
          <table className="w-full text-sm mb-2">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="pb-1">Unit type</th>
                <th className="pb-1 w-20"># Units</th>
                <th className="pb-1 w-28">Rent</th>
                <th className="pb-1 w-28">NNN/utility fee</th>
                <th className="pb-1 w-28 text-right">Monthly total</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {mixRows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 pr-2">
                    <input
                      className="w-full rounded border border-slate-200 px-2 py-1"
                      value={r.label}
                      placeholder="e.g. 2BR/1BA"
                      onChange={(e) =>
                        setMixRows(mixRows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number" min="0" step="1"
                      className="w-full rounded border border-slate-200 px-2 py-1"
                      value={r.count || ""}
                      onChange={(e) =>
                        setMixRows(mixRows.map((x, j) => (j === i ? { ...x, count: parseInt(e.target.value) || 0 } : x)))
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number" min="0" step="any"
                      className="w-full rounded border border-slate-200 px-2 py-1"
                      value={r.rent || ""}
                      onChange={(e) =>
                        setMixRows(mixRows.map((x, j) => (j === i ? { ...x, rent: parseFloat(e.target.value) || 0 } : x)))
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number" min="0" step="any"
                      className="w-full rounded border border-slate-200 px-2 py-1"
                      value={r.fee || ""}
                      onChange={(e) =>
                        setMixRows(mixRows.map((x, j) => (j === i ? { ...x, fee: parseFloat(e.target.value) || 0 } : x)))
                      }
                    />
                  </td>
                  <td className="py-1 text-right font-medium">
                    {money((r.count || 0) * ((r.rent || 0) + (r.fee || 0)))}
                  </td>
                  <td className="py-1 text-right">
                    <button
                      type="button"
                      onClick={() => setMixRows(mixRows.filter((_, j) => j !== i))}
                      className="text-red-500 hover:text-red-700"
                      title="Remove row"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-200">
                <td colSpan={4} className="py-1.5">
                  <button
                    type="button"
                    onClick={() => setMixRows([...mixRows, { label: "", count: 1, rent: 0, fee: 0 }])}
                    className="text-sm text-blue-700 hover:underline"
                  >
                    + Add unit type
                  </button>
                </td>
                <td className="py-1.5 text-right font-semibold">{money(mixMonthlyTotal)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
          <div className="grid sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium mb-1">Other income ($/month)</label>
              <input
                name="otherIncomeMonthly" type="number" min="0" step="any"
                defaultValue={data.otherIncomeMonthly ?? ""}
                placeholder="Laundry, parking, pets…"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2 text-xs text-slate-500 self-end pb-2">
              A vacancy haircut of {data.vacancyAssumption ?? 5}% (editable in Assumptions) is applied to
              the unit-mix rent.
            </div>
          </div>

          <h3 className="text-sm font-medium text-slate-500 mb-2">
            Approximate annual operating costs ($/year)
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            {OPEX_FIELDS.map(([key, lbl]) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1">{lbl}</label>
                <input
                  name={`opex_${key}`} type="number" min="0" step="any"
                  defaultValue={manualOpexDefaults[key] ?? ""}
                  className={inputCls}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={savingCalc}
              className="rounded-md bg-slate-800 text-white px-5 py-2 text-sm hover:bg-slate-900 disabled:opacity-50"
            >
              {savingCalc ? "Calculating…" : "Save & calculate"}
            </button>
            <button
              type="button"
              onClick={() => runAnalysis("manual")}
              disabled={running || !data.metricsManual}
              className="rounded-md bg-blue-700 text-white px-5 py-2 text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
              title={!data.metricsManual ? "Save calculator inputs first" : undefined}
            >
              {running ? "AI analyzing… (a minute or two)" : "Run AI analysis on manual inputs"}
            </button>
            {!data.metricsManual && (
              <span className="text-xs text-slate-500">Save inputs first to enable AI analysis.</span>
            )}
          </div>
        </form>
      </section>
      )}

      {/* Documents tab, nothing analyzed yet */}
      {tab === "documents" && !m && (
        <section className={`${card} text-sm text-slate-500`}>
          No document-based figures yet — upload a Rent Roll and T-12 above and click{" "}
          <b>Run AI analysis</b>. (The Manual entry tab works without documents.)
        </section>
      )}

      {/* Acquisition & cash needed */}
      {m && (
        <section className={card}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Acquisition & cash needed</h2>
            {m.dataSource === "manual" && (
              <span className="text-xs rounded-full bg-slate-100 text-slate-600 px-2.5 py-0.5">
                Based on deal-calculator inputs
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {data.askingPrice !== null && <Stat label="Asking price" value={money(data.askingPrice)} />}
            <Stat label="Offer / purchase price" value={money(data.purchasePrice)} />
            {m.pricePerUnit !== null && <Stat label="Offer per unit" value={money(m.pricePerUnit)} />}
            {m.askingPricePerUnit !== null && (
              <Stat label="Asking per unit" value={money(m.askingPricePerUnit)} />
            )}
            <Stat label="Down payment" value={money(m.cashNeeded.downPayment)} />
            <Stat label="Closing costs" value={money(m.cashNeeded.closingCosts)} />
            <Stat label="Carrying costs" value={money(m.cashNeeded.carryingCosts)} />
            <Stat label="Renovation budget" value={money(m.cashNeeded.renovationBudget)} />
            <Stat label="Total cash needed" value={money(m.cashNeeded.total)} accent />
          </div>
          {data.askingPrice !== null && (
            <p className="text-sm text-slate-600 mt-3">
              Offer is {money(Math.abs(data.purchasePrice - data.askingPrice))}{" "}
              {data.purchasePrice <= data.askingPrice ? "below" : "above"} asking.
            </p>
          )}
        </section>
      )}

      {/* Underwriting results */}
      {m && (
        <section className={card}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Underwriting results</h2>
            <span className="text-xs rounded-full bg-slate-100 text-slate-600 px-2.5 py-0.5">
              {m.dataSource === "documents" ? "From analyzed documents" : "From deal-calculator inputs"}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="NOI (annual)" value={money(m.base.noi)} accent />
            <Stat label="Cap rate" value={pct(m.base.capRate)} accent />
            <Stat label="DSCR" value={ratio(m.base.dscr)} accent />
            <Stat label="Cash-on-cash" value={pct(m.base.cashOnCashReturn)} accent />
            <Stat label="Effective gross income" value={money(m.base.effectiveGrossIncome)} />
            <Stat label="Operating expenses" value={money(m.base.totalOperatingExpenses)} />
            <Stat label="Annual debt service" value={money(m.base.annualDebtService)} />
            <Stat label="Cash flow after debt" value={money(m.base.cashFlowAfterDebtService)} />
            <Stat label="Equity requirement" value={money(m.base.equityRequirement)} />
            <Stat label="Expense ratio" value={pct(m.base.expenseRatio, 1)} />
            <Stat label="Break-even occupancy" value={pct(m.base.breakEvenOccupancy, 1)} />
            <Stat label="Monthly debt service" value={money(m.base.monthlyDebtService)} />
          </div>
          {data.targetReturn !== null && m.base.cashOnCashReturn !== null && (
            <p className="text-sm mt-4 text-slate-600">
              Target cash-on-cash: {pct(data.targetReturn)} —{" "}
              {m.base.cashOnCashReturn >= data.targetReturn ? (
                <span className="text-green-700 font-medium">current projection meets the target</span>
              ) : (
                <span className="text-orange-700 font-medium">current projection is below the target</span>
              )}{" "}
              based on the assumptions entered.
            </p>
          )}
        </section>
      )}

      {/* Valuation & sensitivity */}
      {m && (
        <section className={card}>
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h2 className="font-semibold mb-1">Valuation at cap rates</h2>
              <p className="text-xs text-slate-500 mb-3">
                What the property is worth at each cap rate, given the current NOI of {money(m.base.noi)}.
                Bands are configurable in Settings.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400">
                    <th className="pb-1">Cap rate</th>
                    <th className="pb-1 text-right">Implied value</th>
                    <th className="pb-1 text-right">{data.askingPrice ? "vs asking" : "vs offer"}</th>
                  </tr>
                </thead>
                <tbody>
                  {m.capRateMatrix.map((row) => {
                    const diff = row.vsAsking ?? row.vsOffer;
                    return (
                      <tr key={row.capRatePct} className="border-t border-slate-100">
                        <td className="py-1.5">{row.capRatePct.toFixed(1)}%</td>
                        <td className="py-1.5 text-right font-medium">{money(row.impliedValue)}</td>
                        <td className={`py-1.5 text-right ${diff >= 0 ? "text-green-700" : "text-red-600"}`}>
                          {diff >= 0 ? "+" : "−"}
                          {money(Math.abs(diff))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <h2 className="font-semibold mb-1">What if? — rent sensitivity</h2>
              <p className="text-xs text-slate-500 mb-3">
                Cash-on-cash if effective monthly income moves by the step set in Settings.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400">
                    <th className="pb-1">Scenario</th>
                    <th className="pb-1 text-right">Monthly income</th>
                    <th className="pb-1 text-right">Annual cash flow</th>
                    <th className="pb-1 text-right">CoC</th>
                  </tr>
                </thead>
                <tbody>
                  {m.sensitivity.map((s2) => (
                    <tr
                      key={s2.monthlyRentDelta}
                      className={`border-t border-slate-100 ${s2.monthlyRentDelta === 0 ? "font-medium" : ""}`}
                    >
                      <td className="py-1.5">
                        {s2.monthlyRentDelta === 0
                          ? "Base"
                          : `${s2.monthlyRentDelta > 0 ? "+" : "−"}${money(Math.abs(s2.monthlyRentDelta))}/mo`}
                      </td>
                      <td className="py-1.5 text-right">{money(s2.effectiveMonthlyIncome)}</td>
                      <td className="py-1.5 text-right">{money(s2.annualCashFlow)}</td>
                      <td className="py-1.5 text-right">{pct(s2.cashOnCash, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Value-add */}
      {m && (m.rentGrowth || m.renovation || m.stabilized) && (
        <section className={card}>
          <h2 className="font-semibold mb-4">Value-add analysis</h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {m.rentGrowth && (
              <div>
                <h3 className="text-sm font-medium text-slate-500 mb-2">Rent growth</h3>
                <ul className="text-sm space-y-1">
                  <li>Current avg rent: {money(m.rentGrowth.currentAvgRent)}/mo</li>
                  <li>Market rent: {money(m.rentGrowth.marketRent)}/mo</li>
                  <li>
                    Potential increase:{" "}
                    <b>+{money(m.rentGrowth.perUnitMonthlyIncrease)}/unit/mo</b>
                  </li>
                  <li>
                    Annual revenue increase: <b>{money(m.rentGrowth.annualRevenueIncrease)}</b>
                  </li>
                </ul>
              </div>
            )}
            {m.renovation && (
              <div>
                <h3 className="text-sm font-medium text-slate-500 mb-2">Renovation</h3>
                <ul className="text-sm space-y-1">
                  <li>Total investment: {money(m.renovation.totalInvestment)}</li>
                  <li>Added annual income: {money(m.renovation.additionalAnnualIncome)}</li>
                  <li>
                    Return on renovation: <b>{pct(m.renovation.returnOnRenovation, 1)}</b>
                  </li>
                  <li>Value impact at exit cap: {money(m.renovation.valueImpactAtExitCap)}</li>
                </ul>
              </div>
            )}
            {m.stabilized && (
              <div>
                <h3 className="text-sm font-medium text-slate-500 mb-2">Stabilized projection</h3>
                <ul className="text-sm space-y-1">
                  <li>
                    Stabilized NOI: <b>{money(m.stabilized.stabilizedNoi)}</b>
                  </li>
                  <li>
                    Stabilized cap rate: <b>{pct(m.stabilized.stabilizedCapRate)}</b>
                  </li>
                  <li>Stabilized cash flow: {money(m.stabilized.stabilizedCashFlow)}</li>
                  <li>Stabilized cash-on-cash: {pct(m.stabilized.stabilizedCashOnCash)}</li>
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Assumptions */}
      <section className={card}>
        <h2 className="font-semibold mb-1">Assumptions</h2>
        <p className="text-xs text-slate-500 mb-4">
          Edit any assumption and save — the underwriting engine recalculates immediately. Re-run the AI
          analysis afterwards to refresh the written summary.
        </p>
        <form onSubmit={saveAssumptions} className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">Asking price ($)</label>
            <input name="askingPrice" type="number" step="any" defaultValue={data.askingPrice ?? ""} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Offer / purchase price ($)</label>
            <input name="purchasePrice" type="number" step="any" defaultValue={data.purchasePrice} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Closing costs ($)</label>
            <input name="closingCosts" type="number" step="any" defaultValue={data.closingCosts ?? ""} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Carrying costs ($)</label>
            <input name="carryingCosts" type="number" step="any" defaultValue={data.carryingCosts ?? ""} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Loan amount ($)</label>
            <input name="loanAmount" type="number" step="any" defaultValue={data.loanAmount} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Interest rate (%)</label>
            <input name="interestRate" type="number" step="any" defaultValue={data.interestRate} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Loan term (years)</label>
            <input name="loanTermYears" type="number" step="1" defaultValue={data.loanTermYears} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Down payment ($)</label>
            <input name="downPayment" type="number" step="any" defaultValue={data.downPayment} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Renovation budget ($)</label>
            <input
              name="renovationBudget"
              type="number"
              step="any"
              defaultValue={data.renovationBudget ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Vacancy assumption (%)</label>
            <input
              name="vacancyAssumption"
              type="number"
              step="any"
              defaultValue={data.vacancyAssumption ?? ""}
              placeholder="5"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Market rent ($/unit/mo)</label>
            <input
              name="marketRentPerUnit"
              type="number"
              step="any"
              defaultValue={data.marketRentPerUnit ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Reno cost per unit ($)</label>
            <input
              name="renoCostPerUnit"
              type="number"
              step="any"
              defaultValue={data.renoCostPerUnit ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1"># Units to renovate</label>
            <input
              name="renoUnitCount"
              type="number"
              step="1"
              defaultValue={data.renoUnitCount ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Reno rent increase ($/unit/mo)</label>
            <input
              name="renoRentIncrease"
              type="number"
              step="any"
              defaultValue={data.renoRentIncrease ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Exit cap rate (%)</label>
            <input
              name="exitCapRate"
              type="number"
              step="any"
              defaultValue={data.exitCapRate ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Target cash-on-cash (%)</label>
            <input
              name="targetReturn"
              type="number"
              step="any"
              defaultValue={data.targetReturn ?? ""}
              className={inputCls}
            />
          </div>
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={savingAssumptions}
              className="rounded-md bg-slate-800 text-white px-5 py-2 text-sm hover:bg-slate-900 disabled:opacity-50"
            >
              {savingAssumptions ? "Saving…" : "Save assumptions & recalculate"}
            </button>
          </div>
        </form>
      </section>

      {/* Extracted financials */}
      {tab === "documents" && ex && (
        <section className={card}>
          <h2 className="font-semibold mb-1">Extracted financials</h2>
          <p className="text-xs text-slate-500 mb-4">
            Every figure shows its source document. Click a value to override it — you are responsible for
            verifying all extracted data.
          </p>
          <div className="grid md:grid-cols-2 gap-6">
            {(
              [
                ["Income", "income", INCOME_LABELS],
                ["Expenses", "expenses", EXPENSE_LABELS],
              ] as const
            ).map(([title, section, labels]) => (
              <div key={section}>
                <h3 className="text-sm font-medium text-slate-500 mb-2">{title} (annual)</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(labels).map(([key, lbl]) => {
                      const item = ex[section][key];
                      if (!item) return null;
                      return (
                        <tr key={key} className="border-t border-slate-100">
                          <td className="py-1.5 pr-2">{lbl}</td>
                          <td className="py-1.5 text-right">
                            <button
                              onClick={() => overrideLineItem(section, key, item.annualAmount)}
                              className="font-medium hover:text-blue-700 hover:underline"
                              title={`Source: ${item.source}\nClick to override`}
                            >
                              {money(item.annualAmount)}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <div className="mt-4 text-sm text-slate-600">
            Rent roll: {ex.rentRoll.unitCount} units · avg {money(ex.rentRoll.averageRentPerUnit)}/unit/mo ·{" "}
            {pct(ex.rentRoll.occupancyPct, 1)} occupied
          </div>
          {ex.dataFlags.length > 0 && (
            <div className="mt-4 space-y-2">
              <h3 className="text-sm font-medium text-slate-500">Data verification flags</h3>
              {ex.dataFlags.map((f, i) => (
                <div
                  key={i}
                  className={`text-sm rounded-md border px-3 py-2 ${
                    f.severity === "critical"
                      ? "bg-red-50 border-red-200 text-red-800"
                      : f.severity === "warning"
                        ? "bg-amber-50 border-amber-200 text-amber-800"
                        : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}
                >
                  {f.message}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* AI summary */}
      {ai && (
        <section className={card}>
          <h2 className="font-semibold mb-4">AI property analysis summary</h2>
          <div className="space-y-5 text-sm leading-relaxed">
            <div>
              <h3 className="font-medium text-slate-500 mb-1">Overview</h3>
              <p>{ai.overview}</p>
            </div>
            <div className="grid md:grid-cols-2 gap-5">
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
            <div>
              <h3 className="font-medium text-slate-500 mb-1">Key assumptions</h3>
              <ul className="list-disc pl-5 space-y-1">
                {ai.assumptionNotes.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-md bg-blue-50 border border-blue-100 p-3 text-blue-900">{ai.summary}</div>
          </div>
        </section>
      )}

      <p className="text-xs text-slate-400 pb-8">
        Koby assists real estate professionals but does not replace professional judgment. All AI-generated
        information must be reviewed and verified before being used for investment decisions, investor
        presentations, or acquisitions.
      </p>
    </main>
    </PageShell>
  );
}
