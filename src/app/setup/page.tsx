"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// First-launch setup for the desktop package: collects the Anthropic API key
// once and stores it in Documents\Koby\.env via the desktop-only API route.
export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<{ desktop: boolean; hasKey: boolean } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/desktop/key").then(async (r) => {
      if (r.ok) setStatus(await r.json());
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/desktop/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      router.push("/register");
    } else {
      setError(d.error ?? "Could not save the key.");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-slate-50">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8">
        <h1 className="text-xl font-bold">Welcome to Koby</h1>
        {status === null ? (
          <p className="text-sm text-slate-500 mt-3">Loading…</p>
        ) : !status.desktop ? (
          <p className="text-sm text-slate-500 mt-3">
            This setup page is only used by the desktop version. The API key for this
            deployment is configured on the server.
          </p>
        ) : status.hasKey ? (
          <>
            <p className="text-sm text-slate-600 mt-3">
              Your Anthropic API key is already configured. You can update it below, or continue
              to the app.
            </p>
            <a href="/" className="inline-block mt-3 text-sm text-blue-700 hover:underline">
              Continue to Koby →
            </a>
          </>
        ) : (
          <p className="text-sm text-slate-600 mt-3">
            One-time setup: paste your Anthropic API key so the AI analysis features work. Get a
            key at <span className="font-medium">console.anthropic.com</span> → API keys. It is
            stored only on this computer (Documents\Koby\.env).
          </p>
        )}
        {status?.desktop && (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-…"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-blue-700 text-white px-4 py-2 text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save key & continue"}
            </button>
            <p className="text-xs text-slate-400">
              The underwriting calculator works without a key — only the AI document analysis
              needs one. You can also add it later by editing Documents\Koby\.env.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
