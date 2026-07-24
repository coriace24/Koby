import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";

// List active share links for an analysis.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const analysis = await prisma.analysis.findFirst({ where: { id, userId } });
  if (!analysis) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const links = await prisma.shareLink.findMany({
    where: { analysisId: id, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(links);
}

// Create a share link.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const analysis = await prisma.analysis.findFirst({ where: { id, userId } });
  if (!analysis) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const link = await prisma.shareLink.create({ data: { analysisId: id } });
  return NextResponse.json(link, { status: 201 });
}

// Revoke a share link (?linkId=...).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const analysis = await prisma.analysis.findFirst({ where: { id, userId } });
  if (!analysis) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const linkId = new URL(request.url).searchParams.get("linkId");
  if (!linkId) return NextResponse.json({ error: "linkId query parameter required." }, { status: 400 });

  await prisma.shareLink.updateMany({
    where: { id: linkId, analysisId: id },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
