import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages read bundled data files (AFM fonts, codepages) at runtime,
  // so they must stay external to the server bundle.
  serverExternalPackages: ["pdfkit", "xlsx", "@prisma/client"],
  // Self-contained server build (.next/standalone) — the desktop package ships this.
  output: "standalone",
};

export default nextConfig;
