"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteRequired, setInviteRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === "register") {
      fetch("/api/auth/config")
        .then(async (r) => {
          if (r.ok) setInviteRequired(Boolean((await r.json()).inviteRequired));
        })
        .catch(() => {});
    }
  }, [mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        mode === "register" ? { email, name, password, inviteCode } : { email, password }
      ),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong.");
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-blue-900">Koby</h1>
          <p className="text-sm text-slate-500 mt-1">AI Multifamily Underwriting Assistant</p>
        </div>
        <form onSubmit={submit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold">
            {mode === "login" ? "Sign in" : "Create your account"}
          </h2>
          {mode === "register" && (
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input className={input} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              className={input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={mode === "register" ? 8 : undefined}
              required
            />
            {mode === "register" && (
              <p className="text-xs text-slate-400 mt-1">At least 8 characters.</p>
            )}
          </div>
          {mode === "register" && inviteRequired && (
            <div>
              <label className="block text-sm font-medium mb-1">Invite code</label>
              <input
                className={input}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
              />
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-blue-700 text-white py-2 text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
          >
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
          <p className="text-sm text-slate-500 text-center">
            {mode === "login" ? (
              <>
                No account?{" "}
                <Link href="/register" className="text-blue-700 hover:underline">
                  Register
                </Link>
              </>
            ) : (
              <>
                Already registered?{" "}
                <Link href="/login" className="text-blue-700 hover:underline">
                  Sign in
                </Link>
              </>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
