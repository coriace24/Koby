import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const analyses = await prisma.analysis.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { documents: true } } },
  });
  return NextResponse.json(analyses);
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = await request.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });

  const address = typeof b.address === "string" ? b.address.trim() : "";
  const propertyType = typeof b.propertyType === "string" ? b.propertyType.trim() : "";
  const purchasePrice = num(b.purchasePrice);
  const units = num(b.units);
  const yearBuilt = num(b.yearBuilt);
  const occupancy = num(b.occupancy);
  const loanAmount = num(b.loanAmount);
  const interestRate = num(b.interestRate);
  const loanTermYears = num(b.loanTermYears);
  const downPayment = num(b.downPayment);

  if (
    !address ||
    !propertyType ||
    purchasePrice === null || purchasePrice <= 0 ||
    units === null || units <= 0 ||
    yearBuilt === null ||
    occupancy === null ||
    loanAmount === null ||
    interestRate === null ||
    loanTermYears === null || loanTermYears <= 0 ||
    downPayment === null
  ) {
    return NextResponse.json(
      { error: "Missing or invalid required fields. Required: address, property type, purchase price, units, year built, occupancy, and financing assumptions." },
      { status: 400 }
    );
  }

  const analysis = await prisma.analysis.create({
    data: {
      userId,
      address,
      propertyType,
      purchasePrice,
      units: Math.round(units),
      yearBuilt: Math.round(yearBuilt),
      occupancy,
      loanAmount,
      interestRate,
      loanTermYears: Math.round(loanTermYears),
      downPayment,
      renovationBudget: num(b.renovationBudget),
      targetReturn: num(b.targetReturn),
      strategy: typeof b.strategy === "string" && b.strategy.trim() ? b.strategy.trim() : null,
      notes: typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : null,
    },
  });

  return NextResponse.json(analysis, { status: 201 });
}
