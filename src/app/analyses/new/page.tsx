"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const input =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const label = "block text-sm font-medium mb-1";

export default function NewAnalysisPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    const res = await fetch("/api/analyses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      router.push(`/analyses/${data.id}`);
    } else {
      setError(data.error ?? "Failed to create analysis.");
      setBusy(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-8 flex-1">
      <Link href="/" className="text-sm text-blue-700 hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="text-2xl font-bold mt-2 mb-6">New Property Analysis</h1>

      <form onSubmit={submit} className="space-y-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="font-semibold mb-4">Property details</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={label}>Property address *</label>
              <input name="address" className={input} placeholder="123 Main Street, Springfield, IL" required />
            </div>
            <div>
              <label className={label}>Purchase price ($) *</label>
              <input name="purchasePrice" type="number" min="1" step="any" className={input} required />
            </div>
            <div>
              <label className={label}>Number of units *</label>
              <input name="units" type="number" min="1" step="1" className={input} required />
            </div>
            <div>
              <label className={label}>Property type *</label>
              <select name="propertyType" className={input} defaultValue="Multifamily" required>
                <option>Multifamily</option>
                <option>Garden-style apartments</option>
                <option>Mid-rise apartments</option>
                <option>High-rise apartments</option>
                <option>Mixed-use (residential majority)</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label className={label}>Year built *</label>
              <input name="yearBuilt" type="number" min="1800" max="2100" step="1" className={input} required />
            </div>
            <div>
              <label className={label}>Current occupancy (%) *</label>
              <input name="occupancy" type="number" min="0" max="100" step="any" className={input} required />
            </div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="font-semibold mb-4">Financing assumptions</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Loan amount ($) *</label>
              <input name="loanAmount" type="number" min="0" step="any" className={input} required />
            </div>
            <div>
              <label className={label}>Interest rate (% annual) *</label>
              <input name="interestRate" type="number" min="0" max="30" step="any" className={input} required />
            </div>
            <div>
              <label className={label}>Loan term (years) *</label>
              <input name="loanTermYears" type="number" min="1" max="40" step="1" className={input} required />
            </div>
            <div>
              <label className={label}>Down payment ($) *</label>
              <input name="downPayment" type="number" min="0" step="any" className={input} required />
            </div>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="font-semibold mb-4">Optional</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Renovation budget ($)</label>
              <input name="renovationBudget" type="number" min="0" step="any" className={input} />
            </div>
            <div>
              <label className={label}>Target cash-on-cash return (%)</label>
              <input name="targetReturn" type="number" min="0" max="100" step="any" className={input} />
            </div>
            <div>
              <label className={label}>Investment strategy</label>
              <select name="strategy" className={input} defaultValue="">
                <option value="">— None —</option>
                <option>Buy and hold</option>
                <option>Value-add</option>
                <option>Reposition</option>
                <option>Opportunistic</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Your assumptions / notes</label>
              <textarea
                name="notes"
                rows={3}
                className={input}
                placeholder="Anything the AI analyst should factor in (market context, known issues, plans)…"
              />
            </div>
          </div>
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-blue-700 text-white px-6 py-2.5 text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create analysis"}
        </button>
      </form>
    </main>
  );
}
