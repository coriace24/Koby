import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { getOrCreateSettings, AI_MODELS } from "@/lib/settings";
import { usageSummary, creditBalance, billingEnforced } from "@/lib/billing";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [settings, user, usage, credits] = await Promise.all([
    getOrCreateSettings(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    usageSummary(userId),
    creditBalance(userId),
  ]);
  return NextResponse.json({
    ...settings,
    name: user?.name,
    email: user?.email,
    usage,
    credits,
    billingEnforced: billingEnforced(),
  });
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function PATCH(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = await request.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  await getOrCreateSettings(userId);
  const data: Record<string, unknown> = {};

  if ("aiModel" in b) {
    const valid = AI_MODELS.some((m) => m.value === b.aiModel);
    if (!valid) return NextResponse.json({ error: "Unknown AI model." }, { status: 400 });
    data.aiModel = b.aiModel === "" ? null : b.aiModel;
  }
  for (const key of ["defaultVacancyPct", "defaultClosingCostPct", "defaultInterestRate", "defaultDownPaymentPct", "whatIfRentDelta"] as const) {
    if (key in b) {
      const n = num(b[key]);
      if (n !== null && n >= 0) data[key] = n;
    }
  }
  if ("defaultLoanTermYears" in b) {
    const n = num(b.defaultLoanTermYears);
    if (n !== null && n >= 1 && n <= 40) data.defaultLoanTermYears = Math.round(n);
  }
  // Report branding
  for (const key of [
    "companyName", "companyContact", "companyPhone", "companyEmail",
    "companyWebsite", "companyAddress", "companyLicense",
  ] as const) {
    if (key in b && (typeof b[key] === "string" || b[key] === null)) {
      data[key] = (b[key] as string | null)?.trim().slice(0, 200) || null;
    }
  }
  if ("brandColor" in b) {
    const c = typeof b.brandColor === "string" ? b.brandColor.trim() : "";
    if (c === "") data.brandColor = null;
    else if (/^#[0-9a-fA-F]{6}$/.test(c)) data.brandColor = c;
    else return NextResponse.json({ error: "Brand color must be a hex value like #1a365d." }, { status: 400 });
  }

  if (typeof b.capRateBands === "string") {
    const bands = b.capRateBands
      .split(",")
      .map((s: string) => parseFloat(s.trim()))
      .filter((n: number) => Number.isFinite(n) && n > 0 && n <= 30);
    if (bands.length === 0) {
      return NextResponse.json({ error: "Cap rate bands must be comma-separated percentages, e.g. 6,7,8" }, { status: 400 });
    }
    data.capRateBands = bands.join(",");
  }

  // Profile changes
  if (typeof b.name === "string" && b.name.trim()) {
    await prisma.user.update({ where: { id: userId }, data: { name: b.name.trim() } });
  }
  if (typeof b.newPassword === "string" && b.newPassword.length > 0) {
    if (b.newPassword.length < 8) {
      return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const currentOk =
      typeof b.currentPassword === "string" &&
      (await bcrypt.compare(b.currentPassword, user.passwordHash));
    if (!currentOk) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
    }
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(b.newPassword, 10) },
    });
  }

  const [updated, user, usage, credits] = await Promise.all([
    prisma.userSettings.update({ where: { userId }, data }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    usageSummary(userId),
    creditBalance(userId),
  ]);
  return NextResponse.json({
    ...updated,
    name: user?.name,
    email: user?.email,
    usage,
    credits,
    billingEnforced: billingEnforced(),
  });
}
