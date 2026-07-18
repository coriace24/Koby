"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function Header({ userName }: { userName: string }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold text-blue-900">
          Koby
          <span className="ml-2 text-xs font-normal text-slate-400 hidden sm:inline">
            AI Underwriting Assistant
          </span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-500 hidden sm:inline">{userName}</span>
          <button onClick={logout} className="text-slate-600 hover:text-slate-900">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
