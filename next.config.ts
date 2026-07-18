import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages read bundled data files (AFM fonts, codepages) at runtime,
  // so they must stay external to the server bundle.
  serverExternalPackages: ["pdfkit", "xlsx", "@prisma/client"],
};

export default nextConfig;
