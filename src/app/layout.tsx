import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Koby — AI Multifamily Underwriting",
  description:
    "AI-powered underwriting assistant for multifamily real estate: document extraction, NOI, cap rate, DSCR, value-add analysis, and investor-ready reports.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
