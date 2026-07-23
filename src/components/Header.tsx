"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function Header({ userName }: { userName: string }) {
  const router = useRouter();
  const pathname = usePathname();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-md text-sm ${
        pathname === href
          ? "bg-blue-50 text-blue-800 font-medium"
          : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6 min-w-0">
          <Link href="/" className="text-lg font-bold text-blue-900 shrink-0">
            Koby
          </Link>
          <nav className="flex items-center gap-1">
            {link("/", "Dashboard")}
            {link("/analyses/new", "New analysis")}
            {link("/settings", "Settings")}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm shrink-0">
          <span className="text-slate-500 hidden sm:inline">{userName}</span>
          <button onClick={logout} className="text-slate-600 hover:text-slate-900">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
