import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const MAX_FILE_BYTES = 30 * 1024 * 1024;

const ALLOWED_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".csv"];
const DOC_TYPES = [
  "RENT_ROLL", "T12", "OFFERING_MEMO", "TAX", "INSURANCE", "UTILITY", "LEASE", "FINANCIAL", "OTHER",
];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const analysis = await prisma.analysis.findFirst({ where: { id, userId } });
  if (!analysis) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });

  const file = form.get("file");
  const docTypeRaw = form.get("docType");
  const docType = typeof docTypeRaw === "string" && DOC_TYPES.includes(docTypeRaw) ? docTypeRaw : "OTHER";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: "Unsupported file type. Upload PDF, Excel, or CSV." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File exceeds the 30 MB limit." }, { status: 400 });
  }

  const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
  const dir = path.join(UPLOAD_ROOT, id);
  await fs.mkdir(dir, { recursive: true });
  const storedName = `${crypto.randomUUID()}-${safeName}`;
  const filePath = path.join(dir, storedName);
  await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));

  const doc = await prisma.document.create({
    data: {
      analysisId: id,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      docType,
      size: file.size,
      path: filePath,
    },
  });

  if (analysis.status === "DRAFT") {
    await prisma.analysis.update({ where: { id }, data: { status: "DOCUMENTS_UPLOADED" } });
  }

  return NextResponse.json(doc, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const analysis = await prisma.analysis.findFirst({ where: { id, userId } });
  if (!analysis) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const docId = new URL(request.url).searchParams.get("docId");
  if (!docId) return NextResponse.json({ error: "docId query parameter required." }, { status: 400 });

  const doc = await prisma.document.findFirst({ where: { id: docId, analysisId: id } });
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  await fs.unlink(doc.path).catch(() => {});
  await prisma.document.delete({ where: { id: docId } });
  return NextResponse.json({ ok: true });
}
