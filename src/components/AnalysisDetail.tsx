"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import StatusBadge from "./StatusBadge";
import PageShell from "./PageShell";

// ---------- Types mirrored from the API ----------

interface RawLine {
  label: string;
  annualAmount: number;
  source: string;
  confidence: "high" | "low";
  confirmed?: boolean;
}
interface LineItem {
  annualAmount: number;
  source: string;
  lines?: RawLine[];
}
interface ExcludedLine extends RawLine {
  fromSection: "income" | "expenses";
  fromKey: string;
}
interface Extraction {
  income: Record<string, LineItem>;
  expenses: Record<string, LineItem>;
  rentRoll: { unitCount: number; averageRentPerUnit: number; occupancyPct: number };
  dataFlags: { severity: string; message: string }[];
  excluded?: ExcludedLine[];
}
interface UnitMixRow {
  label: string;
  count: number;
  rent: number;
  fee: number; // legacy — merged into rent on load, kept for API compatibility
}
interface OtherIncomeRow {
  label: string;
  monthly: number;
}
interface Metrics {
  dataSource: "documents" | "manual";
  incomeBasis: "actual" | "scheduled";
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
  projection: {
    years: {
      year: number;
      effectiveGrossIncome: number;
      operatingExpenses: number;
      noi: number;
      debtService: number;
      cashFlow: number;
    }[];
    salePrice: number;
    saleCosts: number;
    loanBalanceAtExit: number;
    netSaleProceeds: number;
    totalCashInvested: number;
    totalCashFlow: number;
    totalProfit: number;
    equityMultiple: number | null;
    irrPct: number | null;
    averageAnnualReturnPct: number | null;
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
  detectedType: string | null;
  detectedNote: string | null;
}
interface ShareLinkInfo {
  id: string;
  createdAt: string;
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
  otherIncomeItems: string | null;
  incomeBasis: string | null;
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
  holdYears: number | null;
  rentGrowthPct: number | null;
  expenseGrowthPct: number | null;
  saleCostPct: number | null;
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

function Stat({ label, value, accent, info }: { label: string; value: string; accent?: boolean; info?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3" title={info}>
      <div className="text-xs text-slate-500">
        {label}
        {info && <span className="ml-1 text-slate-400 cursor-help">ⓘ</span>}
      </div>
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
  const [incomeRows, setIncomeRows] = useState<OtherIncomeRow[]>([]);
  const [savingCalc, setSavingCalc] = useState(false);
  const [tab, setTab] = useState<"manual" | "documents">("manual");
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  const [mappingBusy, setMappingBusy] = useState(false);
  const [shareLinks, setShareLinks] = useState<ShareLinkInfo[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
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
        // Merge the legacy per-unit fee into rent — the column is gone from the UI
        // but older saved rows may still carry one; totals stay identical.
        const rows: UnitMixRow[] = d.unitMix ? JSON.parse(d.unitMix) : [];
        setMixRows(rows.map((r) => ({ ...r, rent: (r.rent || 0) + (r.fee || 0), fee: 0 })));
      } catch {
        setMixRows([]);
      }
      try {
        const items: OtherIncomeRow[] = d.otherIncomeItems ? JSON.parse(d.otherIncomeItems) : [];
        if (items.length === 0 && d.otherIncomeMonthly && d.otherIncomeMonthly > 0) {
          items.push({ label: "Other income", monthly: d.otherIncomeMonthly });
        }
        setIncomeRows(items);
      } catch {
        setIncomeRows([]);
      }
    } else if (res.status === 404) {
      setError("Analysis not found.");
    } else {
      setError("Failed to load analysis.");
    }
  }, [id]);

  const loadShareLinks = useCallback(async () => {
    const res = await fetch(`/api/analyses/${id}/share`);
    if (res.ok) setShareLinks(await res.json());
  }, [id]);

  useEffect(() => {
    load();
    loadShareLinks();
  }, [load, loadShareLinks]);

  async function createShareLink() {
    const res = await fetch(`/api/analyses/${id}/share`, { method: "POST" });
    if (res.ok) {
      await loadShareLinks();
      setShareOpen(true);
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to create share link.");
    }
  }

  async function revokeShareLink(linkId: string) {
    await fetch(`/api/analyses/${id}/share?linkId=${linkId}`, { method: "DELETE" });
    await loadShareLinks();
  }

  async function copyShareLink(linkId: string) {
    const url = `${window.location.origin}/share/${linkId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLinkId(linkId);
      setTimeout(() => setCopiedLinkId(null), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

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
      otherIncomeItems: incomeRows.filter((r) => r.label || r.monthly > 0),
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

  async function setIncomeBasis(basis: "actual" | "scheduled") {
    setError(null);
    const res = await fetch(`/api/analyses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incomeBasis: basis }),
    });
    if (res.ok) setData(await res.json());
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

  // ----- Raw-line mapping actions (all persist via PATCH {extraction}) -----

  async function patchExtraction(next: Extraction) {
    setMappingBusy(true);
    setError(null);
    const res = await fetch(`/api/analyses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraction: next }),
    });
    if (res.ok) setData(await res.json());
    else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to update the mapping.");
    }
    setMappingBusy(false);
  }

  function retag(item: LineItem) {
    if (!item.source.includes("adjusted by user")) item.source = `${item.source} (adjusted by user)`;
  }

  async function moveLine(section: "income" | "expenses", fromKey: string, idx: number, toKey: string) {
    if (!data?.extractionParsed || mappingBusy) return;
    const next = structuredClone(data.extractionParsed);
    const from = next[section][fromKey];
    const line = from.lines?.[idx];
    if (!line) return;
    from.lines!.splice(idx, 1);
    from.annualAmount -= line.annualAmount;
    retag(from);
    const to = next[section][toKey];
    if (!to) return;
    line.confirmed = true;
    line.confidence = "high";
    (to.lines ??= []).push(line);
    to.annualAmount += line.annualAmount;
    retag(to);
    await patchExtraction(next);
  }

  async function excludeLine(section: "income" | "expenses", fromKey: string, idx: number) {
    if (!data?.extractionParsed || mappingBusy) return;
    const next = structuredClone(data.extractionParsed);
    const from = next[section][fromKey];
    const line = from.lines?.[idx];
    if (!line) return;
    from.lines!.splice(idx, 1);
    from.annualAmount -= line.annualAmount;
    retag(from);
    (next.excluded ??= []).push({ ...line, confirmed: true, fromSection: section, fromKey });
    await patchExtraction(next);
  }

  async function restoreLine(excludedIdx: number) {
    if (!data?.extractionParsed || mappingBusy) return;
    const next = structuredClone(data.extractionParsed);
    const line = next.excluded?.[excludedIdx];
    if (!line) return;
    next.excluded!.splice(excludedIdx, 1);
    const target = next[line.fromSection]?.[line.fromKey];
    if (!target) return;
    if (
      target.source.includes("User override") &&
      !window.confirm(
        `You manually overrode this category's total to ${money(target.annualAmount)}. Restoring adds ${money(line.annualAmount)} on top of that. Continue?`
      )
    ) {
      return;
    }
    const { fromSection: _s, fromKey: _k, ...raw } = line;
    (target.lines ??= []).push(raw);
    target.annualAmount += line.annualAmount;
    retag(target);
    await patchExtraction(next);
  }

  async function confirmLine(section: "income" | "expenses", key: string, idx: number) {
    if (!data?.extractionParsed || mappingBusy) return;
    const next = structuredClone(data.extractionParsed);
    const line = next[section][key].lines?.[idx];
    if (!line) return;
    line.confirmed = true;
    await patchExtraction(next);
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
    // Keep the raw-line ledger — an override changes the total, not the mapping.
    extraction[section][key] = {
      annualAmount: n,
      source: "User override",
      lines: extraction[section][key].lines ?? [],
    };
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
  const otherIncomeTotal = incomeRows.reduce((sum, r) => sum + (r.monthly || 0), 0);

  // Extraction coverage: which of the 13 statement lines the AI actually found.
  const coverage = (() => {
    if (!ex) return null;
    const lines: { key: string; label: string; found: boolean }[] = [];
    for (const [section, labels] of [
      ["income", INCOME_LABELS],
      ["expenses", EXPENSE_LABELS],
    ] as const) {
      for (const [key, lbl] of Object.entries(labels)) {
        const item = ex[section][key];
        if (!item) continue;
        const found = item.annualAmount !== 0 || !/not\s*found/i.test(item.source);
        lines.push({ key, label: lbl, found });
      }
    }
    const missing = lines.filter((l) => !l.found);
    return { total: lines.length, found: lines.length - missing.length, missing };
  })();

  // Upload sanity check: content type detected by the AI vs the label chosen.
  const docWarnings = data.documents
    .filter((d) => {
      if (!d.detectedType) return false;
      if (d.detectedType === "CALC_WORKSHEET") return true;
      if (d.docType === "RENT_ROLL" && d.detectedType !== "RENT_ROLL") return true;
      if (d.docType === "T12" && d.detectedType !== "T12") return true;
      return false;
    })
    .map((d) => ({
      filename: d.filename,
      message:
        d.detectedType === "CALC_WORKSHEET"
          ? `"${d.filename}" looks like a calculator/assumption worksheet, not a property record — extraction from it will likely be incomplete or misleading.`
          : `"${d.filename}" is labeled ${DOC_TYPES.find(([v]) => v === d.docType)?.[1] ?? d.docType} but its content looks like ${(d.detectedType ?? "other").replace("_", " ").toLowerCase()}. ${d.detectedNote ?? ""}`,
    }));

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
            <button
              onClick={() => setShareOpen(!shareOpen)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Share{shareLinks.length > 0 && ` (${shareLinks.length})`}
            </button>
            <button onClick={deleteAnalysis} className="text-sm text-red-600 hover:underline">
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Share links */}
      {shareOpen && (
        <section className={card}>
          <h2 className="font-semibold mb-1">Share with investors</h2>
          <p className="text-xs text-slate-500 mb-4">
            A share link opens a read-only branded summary (with PDF download) — no login needed. Anyone
            with the link can view it, so revoke links you no longer want out there.
          </p>
          {shareLinks.length > 0 && (
            <ul className="divide-y divide-slate-100 mb-4">
              {shareLinks.map((l) => (
                <li key={l.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <a
                    href={`/share/${l.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-700 hover:underline truncate max-w-full"
                  >
                    {typeof window !== "undefined" ? window.location.origin : ""}/share/{l.id}
                  </a>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-slate-400">
                      created {new Date(l.createdAt).toLocaleDateString()}
                    </span>
                    <button onClick={() => copyShareLink(l.id)} className="text-xs text-blue-700 hover:underline">
                      {copiedLinkId === l.id ? "Copied!" : "Copy link"}
                    </button>
                    <button onClick={() => revokeShareLink(l.id)} className="text-xs text-red-600 hover:underline">
                      Revoke
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={createShareLink}
            className="rounded-md bg-blue-700 text-white px-4 py-2 text-sm font-medium hover:bg-blue-800"
          >
            Create share link
          </button>
        </section>
      )}

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
        {docWarnings.length > 0 && (
          <div className="mb-4 space-y-2">
            {docWarnings.map((w, i) => (
              <div key={i} className="text-sm rounded-md border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
                ⚠ {w.message} You can still run the analysis, but expect data flags — or upload the
                right document type.
              </div>
            ))}
          </div>
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
          <div className="rounded-xl border border-green-300 bg-green-50/60 p-4 mb-5">
          <h3 className="text-base font-semibold text-green-800 border-b border-green-200 pb-1 mb-3">
            Income
          </h3>
          <h4 className="text-sm font-medium text-slate-500 mb-2">Unit mix & rents ($/month)</h4>
          <table className="w-full text-sm mb-2">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="pb-1">Unit type</th>
                <th className="pb-1 w-24"># Units</th>
                <th className="pb-1 w-32">Rent</th>
                <th className="pb-1 w-32 text-right">Monthly total</th>
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
                <td colSpan={3} className="py-1.5">
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

          <h4 className="text-sm font-medium text-slate-500 mb-2">Other income ($/month)</h4>
          <table className="w-full text-sm mb-1">
            <tbody>
              {incomeRows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 pr-2">
                    <input
                      className="w-full rounded border border-slate-200 px-2 py-1"
                      value={r.label}
                      placeholder="e.g. Laundry, parking, pet fees, storage"
                      onChange={(e) =>
                        setIncomeRows(incomeRows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                      }
                    />
                  </td>
                  <td className="py-1 w-32">
                    <input
                      type="number" min="0" step="any"
                      className="w-full rounded border border-slate-200 px-2 py-1"
                      value={r.monthly || ""}
                      onChange={(e) =>
                        setIncomeRows(
                          incomeRows.map((x, j) => (j === i ? { ...x, monthly: parseFloat(e.target.value) || 0 } : x))
                        )
                      }
                    />
                  </td>
                  <td className="py-1 w-8 text-right">
                    <button
                      type="button"
                      onClick={() => setIncomeRows(incomeRows.filter((_, j) => j !== i))}
                      className="text-red-500 hover:text-red-700"
                      title="Remove row"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-200">
                <td className="py-1.5">
                  <button
                    type="button"
                    onClick={() => setIncomeRows([...incomeRows, { label: "", monthly: 0 }])}
                    className="text-sm text-blue-700 hover:underline"
                  >
                    + Add other income type
                  </button>
                </td>
                <td className="py-1.5 text-right font-semibold w-32">{money(otherIncomeTotal)}</td>
                <td className="w-8"></td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-slate-500">
            A vacancy haircut of {data.vacancyAssumption ?? 5}% (editable in Assumptions) is applied to
            the unit-mix rent. Other income is not reduced for vacancy.
          </p>
          </div>

          <div className="rounded-xl border border-red-300 bg-red-50/60 p-4 mb-5">
          <h3 className="text-base font-semibold text-red-800 border-b border-red-200 pb-1 mb-3">
            Expenses
          </h3>
          <h4 className="text-sm font-medium text-slate-500 mb-2">
            Approximate annual operating costs ($/year)
          </h4>
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

      {/* Extraction coverage + income basis (documents tab) */}
      {tab === "documents" && ex && coverage && (
        <section className={`${card} space-y-3`}>
          <div className="text-sm">
            <span className="font-semibold">Extraction coverage: </span>
            {coverage.found} of {coverage.total} financial line items found in the documents
            {coverage.missing.length > 0 && (
              <>
                {" · "}
                <span className="text-amber-700">
                  defaulted to $0: {coverage.missing.map((l) => l.label).join(", ")}
                </span>
              </>
            )}
            . Every $0 line lowers or skews the results below — click a value in Extracted
            financials to fill gaps manually.
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm border-t border-slate-100 pt-3">
            <span className="font-semibold">Income basis:</span>
            {(
              [
                ["actual", "Actual collections (what the T-12 shows was collected)"],
                ["scheduled", "Scheduled rent − vacancy (the Excel-calculator convention)"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="incomeBasis"
                  checked={(data.incomeBasis === "scheduled" ? "scheduled" : "actual") === value}
                  onChange={() => setIncomeBasis(value)}
                />
                {label}
              </label>
            ))}
          </div>
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
            <Stat
              label="NOI (annual)"
              value={money(m.base.noi)}
              accent
              info={`Effective gross income ${money(m.base.effectiveGrossIncome)} − operating expenses ${money(m.base.totalOperatingExpenses)} = ${money(m.base.noi)}. Debt service is not part of NOI.`}
            />
            <Stat
              label="Cap rate"
              value={pct(m.base.capRate)}
              accent
              info={`NOI ${money(m.base.noi)} ÷ offer price ${money(data.purchasePrice)} = ${pct(m.base.capRate)}.`}
            />
            <Stat
              label="DSCR"
              value={ratio(m.base.dscr)}
              accent
              info={`NOI ${money(m.base.noi)} ÷ annual debt service ${money(m.base.annualDebtService)} = ${ratio(m.base.dscr)}. Lenders usually want 1.20–1.25+.`}
            />
            <Stat
              label="Cash-on-cash"
              value={pct(m.base.cashOnCashReturn)}
              accent
              info={`Cash flow after debt ${money(m.base.cashFlowAfterDebtService)} ÷ total cash needed ${money(m.cashNeeded.total)} (down + closing + carrying + reno) = ${pct(m.base.cashOnCashReturn)}. On down payment alone (the Excel convention): ${data.downPayment > 0 ? pct((m.base.cashFlowAfterDebtService / data.downPayment) * 100) : "—"}.`}
            />
            <Stat
              label="Effective gross income"
              value={money(m.base.effectiveGrossIncome)}
              info={
                m.dataSource === "documents"
                  ? m.incomeBasis === "scheduled"
                    ? "Scheduled rent − vacancy + other income (basis switchable above)."
                    : "Actual collected rent from the T-12 + other income (basis switchable above)."
                  : `Unit-mix rent − ${data.vacancyAssumption ?? 5}% vacancy + other income.`
              }
            />
            <Stat label="Operating expenses" value={money(m.base.totalOperatingExpenses)} />
            <Stat
              label="Annual debt service"
              value={money(m.base.annualDebtService)}
              info={`Monthly payment ${money(m.base.monthlyDebtService)} × 12 on ${money(data.loanAmount)} at ${data.interestRate}% over ${data.loanTermYears} years.`}
            />
            <Stat label="Cash flow after debt" value={money(m.base.cashFlowAfterDebtService)} />
            <Stat label="Equity requirement" value={money(m.base.equityRequirement)} />
            <Stat
              label="Expense ratio"
              value={pct(m.base.expenseRatio, 1)}
              info={`Operating expenses ÷ effective gross income. 35–55% is typical for multifamily.`}
            />
            <Stat
              label="Break-even occupancy"
              value={pct(m.base.breakEvenOccupancy, 1)}
              info={`(Operating expenses + debt service) ÷ gross scheduled income — the textbook basis. The Excel divides by effective income instead, which reads a few points higher.`}
            />
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

      {/* Manual vs Documents reconciliation */}
      {data.metricsManual && data.metricsDocuments && (
        <section className={card}>
          <h2 className="font-semibold mb-1">Manual entry vs documents — reconciliation</h2>
          <p className="text-xs text-slate-500 mb-4">
            Your assumptions side by side with what the documents show. Gaps here are the story:
            they are what to verify with the broker or seller.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="pb-1"></th>
                  <th className="pb-1 text-right">Manual entry</th>
                  <th className="pb-1 text-right">Documents</th>
                  <th className="pb-1 text-right">Difference</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Effective gross income", (x: Metrics) => x.base.effectiveGrossIncome, money, true],
                    ["Operating expenses", (x: Metrics) => x.base.totalOperatingExpenses, money, false],
                    ["NOI", (x: Metrics) => x.base.noi, money, true],
                    ["Cap rate", (x: Metrics) => x.base.capRate, (n: number | null) => pct(n), true],
                    ["DSCR", (x: Metrics) => x.base.dscr, (n: number | null) => ratio(n), true],
                    ["Cash flow after debt", (x: Metrics) => x.base.cashFlowAfterDebtService, money, true],
                    ["Cash-on-cash", (x: Metrics) => x.base.cashOnCashReturn, (n: number | null) => pct(n), true],
                  ] as [string, (x: Metrics) => number | null, (n: number | null) => string, boolean][]
                ).map(([label, get, fmt, goodWhenHigher]) => {
                  const a = get(data.metricsManual!);
                  const b2 = get(data.metricsDocuments!);
                  const diff = a !== null && b2 !== null ? b2 - a : null;
                  const isMoney = fmt === money;
                  const favorable = diff !== null && (goodWhenHigher ? diff > 0 : diff < 0);
                  return (
                    <tr key={label} className="border-t border-slate-100">
                      <td className="py-1.5 pr-2">{label}</td>
                      <td className="py-1.5 text-right">{fmt(a)}</td>
                      <td className="py-1.5 text-right">{fmt(b2)}</td>
                      <td
                        className={`py-1.5 text-right font-medium ${
                          diff === null || Math.abs(diff) < 0.005
                            ? "text-slate-400"
                            : favorable
                              ? "text-green-700"
                              : "text-red-600"
                        }`}
                      >
                        {diff === null
                          ? "—"
                          : `${diff >= 0 ? "+" : "−"}${
                              isMoney ? money(Math.abs(diff)) : Math.abs(diff).toFixed(2) + (label.includes("DSCR") ? "" : " pts")
                            }`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Documents column uses{" "}
            {data.metricsDocuments.incomeBasis === "scheduled"
              ? "scheduled rent − vacancy (Excel convention)"
              : "actual collected rent"}
            ; the manual column always uses your unit-mix rent − vacancy assumption. Income basis is
            switchable on the Uploaded documents tab.
            {ex &&
              (ex.excluded?.length ||
                Object.values({ ...ex.income, ...ex.expenses }).some(
                  (it) =>
                    it.source.includes("User override") ||
                    it.source.includes("adjusted by user") ||
                    it.lines?.some((l) => l.confirmed)
                )) && (
                <span className="block mt-1 text-blue-800">
                  ✎ The documents column reflects your overrides and re-mappings — these are the final
                  numbers used, not the raw extraction.
                </span>
              )}
          </p>
        </section>
      )}

      {/* Hold-period returns */}
      {m && (
        <section className={card}>
          <h2 className="font-semibold mb-1">Hold-period returns (IRR)</h2>
          {m.projection ? (
            <>
              <p className="text-xs text-slate-500 mb-4">
                Projected sale after {data.holdYears} year{(data.holdYears ?? 0) === 1 ? "" : "s"} at a{" "}
                {pct(data.exitCapRate, 1)} exit cap, with {pct(data.rentGrowthPct ?? 2, 1)} annual income
                growth and {pct(data.expenseGrowthPct ?? 2, 1)} expense growth. Edit these in Assumptions
                below.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <Stat label="IRR" value={pct(m.projection.irrPct)} accent />
                <Stat
                  label="Equity multiple"
                  value={m.projection.equityMultiple !== null ? `${m.projection.equityMultiple.toFixed(2)}x` : "—"}
                  accent
                />
                <Stat label="Total profit" value={money(m.projection.totalProfit)} accent />
                <Stat label="Avg annual return" value={pct(m.projection.averageAnnualReturnPct)} />
                <Stat label="Projected sale price" value={money(m.projection.salePrice)} />
                <Stat label="Loan balance at exit" value={money(m.projection.loanBalanceAtExit)} />
                <Stat label="Net sale proceeds" value={money(m.projection.netSaleProceeds)} />
                <Stat label="Total cash invested" value={money(m.projection.totalCashInvested)} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400">
                      <th className="pb-1">Year</th>
                      <th className="pb-1 text-right">Effective income</th>
                      <th className="pb-1 text-right">Op. expenses</th>
                      <th className="pb-1 text-right">NOI</th>
                      <th className="pb-1 text-right">Debt service</th>
                      <th className="pb-1 text-right">Cash flow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.projection.years.map((y) => (
                      <tr key={y.year} className="border-t border-slate-100">
                        <td className="py-1.5">{y.year}</td>
                        <td className="py-1.5 text-right">{money(y.effectiveGrossIncome)}</td>
                        <td className="py-1.5 text-right">{money(y.operatingExpenses)}</td>
                        <td className="py-1.5 text-right font-medium">{money(y.noi)}</td>
                        <td className="py-1.5 text-right">{money(y.debtService)}</td>
                        <td className="py-1.5 text-right">{money(y.cashFlow)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Set a <b>hold period</b> and an <b>exit cap rate</b> in the Assumptions section below to
              project year-by-year cash flows, sale proceeds, IRR, and equity multiple.
            </p>
          )}
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
          <div>
            <label className="block text-xs font-medium mb-1">Hold period (years)</label>
            <input
              name="holdYears"
              type="number"
              step="1"
              min="0"
              defaultValue={data.holdYears ?? ""}
              placeholder="e.g. 5 — enables IRR"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Income growth (%/yr)</label>
            <input
              name="rentGrowthPct"
              type="number"
              step="any"
              defaultValue={data.rentGrowthPct ?? ""}
              placeholder="2"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Expense growth (%/yr)</label>
            <input
              name="expenseGrowthPct"
              type="number"
              step="any"
              defaultValue={data.expenseGrowthPct ?? ""}
              placeholder="2"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Sale costs (% of sale price)</label>
            <input
              name="saleCostPct"
              type="number"
              step="any"
              defaultValue={data.saleCostPct ?? ""}
              placeholder="5"
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
            Every figure shows its source document; click a value to override a total. Categories with ▸
            expand to show the document&apos;s own line items, exactly as the owner labeled them — move a
            line to a different category (or exclude it) if the AI mapped it wrong, and confirm the amber
            ones it was unsure about. Owners label finances differently; this is where you make the
            mapping yours.
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
                      const catId = `${section}.${key}`;
                      const lines = item.lines ?? [];
                      const unconfirmedLow = lines.filter((l) => l.confidence === "low" && !l.confirmed).length;
                      const open = expandedCats[catId];
                      return (
                        <Fragment key={key}>
                          <tr className="border-t border-slate-100">
                            <td className="py-1.5 pr-2">
                              {lines.length > 0 ? (
                                <button
                                  onClick={() => setExpandedCats({ ...expandedCats, [catId]: !open })}
                                  className="hover:text-blue-700"
                                  title="Show the document lines mapped into this category"
                                >
                                  <span className="inline-block w-4 text-slate-400">{open ? "▾" : "▸"}</span>
                                  {lbl}
                                  <span className="ml-1.5 text-xs text-slate-400">({lines.length})</span>
                                  {unconfirmedLow > 0 && (
                                    <span
                                      className="ml-1.5 text-xs rounded-full bg-amber-100 text-amber-800 px-1.5"
                                      title="Mappings the AI was unsure about — expand to confirm or move them"
                                    >
                                      {unconfirmedLow} to confirm
                                    </span>
                                  )}
                                </button>
                              ) : (
                                <span className="pl-4">{lbl}</span>
                              )}
                            </td>
                            <td className="py-1.5 text-right">
                              <button
                                onClick={() => overrideLineItem(section, key, item.annualAmount)}
                                className="font-medium hover:text-blue-700 hover:underline"
                                title={`Source: ${item.source}\nClick to override the total`}
                              >
                                {money(item.annualAmount)}
                              </button>
                            </td>
                          </tr>
                          {open &&
                            lines.map((line, idx) => (
                              <tr key={`${key}-${idx}`} className="bg-slate-50/60">
                                <td className="py-1 pl-6 pr-2 text-xs" colSpan={1}>
                                  <span className="text-slate-700">“{line.label}”</span>
                                  <span className="ml-1 text-slate-400" title={line.source}>
                                    · {money(line.annualAmount)}
                                  </span>
                                  {line.confidence === "low" && !line.confirmed && (
                                    <button
                                      onClick={() => confirmLine(section, key, idx)}
                                      disabled={mappingBusy}
                                      className="ml-2 text-xs rounded bg-amber-100 text-amber-800 px-1.5 hover:bg-amber-200 disabled:opacity-50"
                                      title="The AI wasn't sure this belongs here — click to confirm the mapping"
                                    >
                                      confirm
                                    </button>
                                  )}
                                  {line.confirmed && <span className="ml-2 text-xs text-green-700">✓ verified</span>}
                                </td>
                                <td className="py-1 pr-1 text-right">
                                  <select
                                    className="text-xs rounded border border-slate-200 bg-white px-1 py-0.5 max-w-36 disabled:opacity-50"
                                    value=""
                                    disabled={mappingBusy}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (v === "__exclude__") excludeLine(section, key, idx);
                                      else if (v) moveLine(section, key, idx, v);
                                    }}
                                  >
                                    <option value="">Move to…</option>
                                    {Object.entries(labels)
                                      .filter(([k]) => k !== key)
                                      .map(([k, l]) => (
                                        <option key={k} value={k}>
                                          {l}
                                        </option>
                                      ))}
                                    <option value="__exclude__">Exclude from analysis</option>
                                  </select>
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          {ex.excluded && ex.excluded.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-slate-500 mb-1">Excluded from analysis</h3>
              <ul className="text-xs text-slate-500 space-y-1">
                {ex.excluded.map((line, i) => (
                  <li key={i}>
                    “{line.label}” · {money(line.annualAmount)} (was{" "}
                    {(line.fromSection === "income" ? INCOME_LABELS : EXPENSE_LABELS)[line.fromKey] ?? line.fromKey})
                    <button
                      onClick={() => restoreLine(i)}
                      disabled={mappingBusy}
                      className="ml-2 text-blue-700 hover:underline disabled:opacity-50"
                    >
                      restore
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
