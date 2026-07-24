"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";

const input =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const label = "block text-sm font-medium mb-1";
const card = "bg-white border border-slate-200 rounded-xl p-6";

const AI_MODELS = [
  { value: "", label: "Server default (claude-opus-4-8)" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8 — most capable" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 — near-Opus quality, ~60% cheaper" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest and cheapest" },
];

interface Settings {
  name: string;
  email: string;
  aiModel: string | null;
  defaultVacancyPct: number;
  defaultClosingCostPct: number;
  defaultInterestRate: number;
  defaultLoanTermYears: number;
  defaultDownPaymentPct: number;
  capRateBands: string;
  whatIfRentDelta: number;
  companyName: string | null;
  companyContact: string | null;
  brandColor: string | null;
  usage?: { runs: number; inputTokens: number; outputTokens: number; costUsd: number };
  credits?: number;
  billingEnforced?: boolean;
}

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    fetch("/api/settings").then(async (r) => {
      if (r.ok) setS(await r.json());
    });
  }, []);

  async function save(body: Record<string, unknown>, successText: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setS(data);
      setMsg({ ok: true, text: successText });
    } else {
      setMsg({ ok: false, text: data.error ?? "Failed to save." });
    }
    setBusy(false);
  }

  if (!s) return <main className="max-w-3xl mx-auto w-full px-6 py-8 text-slate-500">Loading…</main>;

  const usage = s.usage ?? { runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

  return (
    <>
    <Header userName={s.name} />
    <main className="max-w-3xl mx-auto w-full px-6 py-8 flex-1 space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      {msg && (
        <p
          className={`text-sm rounded-md border px-3 py-2 ${
            msg.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {msg.text}
        </p>
      )}

      {/* AI */}
      <section className={card}>
        <h2 className="font-semibold mb-1">AI analyst</h2>
        <p className="text-xs text-slate-500 mb-4">
          Which Claude model reviews documents and writes summaries. Applies to your future analysis runs.
        </p>
        <div className="max-w-md">
          <label className={label}>Claude model</label>
          <select
            className={input}
            value={s.aiModel ?? ""}
            onChange={(e) => save({ aiModel: e.target.value }, "AI model updated.")}
            disabled={busy}
          >
            {AI_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* AI usage */}
      <section className={card}>
        <h2 className="font-semibold mb-1">AI usage</h2>
        <p className="text-xs text-slate-500 mb-4">
          Every AI run is metered — this is the record a pay-per-use plan will bill from.
          {s.billingEnforced
            ? ` Billing is enforced: ${s.credits ?? 0} credit${(s.credits ?? 0) === 1 ? "" : "s"} remaining.`
            : " Billing is not enforced yet (unlimited runs)."}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {[
            ["AI runs", String(usage.runs)],
            ["Input tokens", usage.inputTokens.toLocaleString()],
            ["Output tokens", usage.outputTokens.toLocaleString()],
            ["Est. API cost", `$${usage.costUsd.toFixed(2)}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-50 border border-slate-100 p-3">
              <div className="text-xs text-slate-500">{label}</div>
              <div className="text-lg font-semibold">{value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Report branding */}
      <section className={card}>
        <h2 className="font-semibold mb-1">Report branding</h2>
        <p className="text-xs text-slate-500 mb-4">
          Shown on PDF reports and shared report pages — your name in front of investors, not ours.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            save(Object.fromEntries(fd.entries()), "Branding saved.");
          }}
          className="grid sm:grid-cols-3 gap-4"
        >
          <div>
            <label className={label}>Company / your name</label>
            <input name="companyName" defaultValue={s.companyName ?? ""} className={input} placeholder="Acme Realty Group" />
          </div>
          <div>
            <label className={label}>Contact line</label>
            <input name="companyContact" defaultValue={s.companyContact ?? ""} className={input} placeholder="jane@acme.com · (555) 010-2233" />
          </div>
          <div>
            <label className={label}>Accent color (hex)</label>
            <input name="brandColor" defaultValue={s.brandColor ?? ""} className={input} placeholder="#1a365d" />
          </div>
          <div className="sm:col-span-3">
            <button type="submit" disabled={busy} className="rounded-md bg-blue-700 text-white px-5 py-2 text-sm font-medium hover:bg-blue-800 disabled:opacity-50">
              Save branding
            </button>
          </div>
        </form>
      </section>

      {/* Underwriting defaults */}
      <section className={card}>
        <h2 className="font-semibold mb-1">Underwriting defaults</h2>
        <p className="text-xs text-slate-500 mb-4">
          Pre-filled into new analyses and used by the calculator. You can still override per deal.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            save(Object.fromEntries(fd.entries()), "Defaults saved.");
          }}
          className="grid sm:grid-cols-3 gap-4"
        >
          <div>
            <label className={label}>Vacancy (%)</label>
            <input name="defaultVacancyPct" type="number" step="any" defaultValue={s.defaultVacancyPct} className={input} />
          </div>
          <div>
            <label className={label}>Closing costs (% of price)</label>
            <input name="defaultClosingCostPct" type="number" step="any" defaultValue={s.defaultClosingCostPct} className={input} />
          </div>
          <div>
            <label className={label}>Interest rate (%)</label>
            <input name="defaultInterestRate" type="number" step="any" defaultValue={s.defaultInterestRate} className={input} />
          </div>
          <div>
            <label className={label}>Loan term (years)</label>
            <input name="defaultLoanTermYears" type="number" step="1" defaultValue={s.defaultLoanTermYears} className={input} />
          </div>
          <div>
            <label className={label}>Down payment (%)</label>
            <input name="defaultDownPaymentPct" type="number" step="any" defaultValue={s.defaultDownPaymentPct} className={input} />
          </div>
          <div>
            <label className={label}>What-if rent step ($/mo)</label>
            <input name="whatIfRentDelta" type="number" step="any" defaultValue={s.whatIfRentDelta} className={input} />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Cap-rate valuation bands (%)</label>
            <input name="capRateBands" defaultValue={s.capRateBands} className={input} placeholder="6,7,8" />
            <p className="text-xs text-slate-400 mt-1">
              Comma-separated. "What is the property worth at each of these cap rates?"
            </p>
          </div>
          <div className="sm:col-span-3">
            <button type="submit" disabled={busy} className="rounded-md bg-blue-700 text-white px-5 py-2 text-sm font-medium hover:bg-blue-800 disabled:opacity-50">
              Save defaults
            </button>
          </div>
        </form>
      </section>

      {/* Profile */}
      <section className={card}>
        <h2 className="font-semibold mb-4">Profile</h2>
        <div className="grid sm:grid-cols-2 gap-4 max-w-xl">
          <div>
            <label className={label}>Name</label>
            <input
              defaultValue={s.name}
              className={input}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value.trim() !== s.name)
                  save({ name: e.target.value }, "Name updated.");
              }}
            />
          </div>
          <div>
            <label className={label}>Email</label>
            <input value={s.email} className={`${input} bg-slate-50 text-slate-500`} disabled />
          </div>
        </div>
        <form
          className="grid sm:grid-cols-2 gap-4 max-w-xl mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            save({ currentPassword, newPassword }, "Password changed.").then(() => {
              setCurrentPassword("");
              setNewPassword("");
            });
          }}
        >
          <div>
            <label className={label}>Current password</label>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={input} required />
          </div>
          <div>
            <label className={label}>New password (min 8 chars)</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={input} minLength={8} required />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="rounded-md bg-slate-800 text-white px-5 py-2 text-sm hover:bg-slate-900 disabled:opacity-50">
              Change password
            </button>
          </div>
        </form>
      </section>

      <p className="text-xs text-slate-400 pb-8">
        The Anthropic API key is configured on the server (.env or a Codespaces secret), not here — so it
        never passes through the browser.
      </p>
    </main>
    </>
  );
}
