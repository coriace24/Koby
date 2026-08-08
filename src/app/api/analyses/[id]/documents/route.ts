import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";
import { saveUpload, deleteUpload } from "@/lib/storage";
import { classifyDocument } from "@/lib/ai";
import { recordAiRun } from "@/lib/billing";

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

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await saveUpload(id, file.name, buffer);

  // Cheap AI sanity check: does the file's content match its label? Skipped
  // gracefully when no API key is configured — uploads must never fail on it.
  let detectedType: string | null = null;
  let detectedNote: string | null = null;
  try {
    const { classification, usage } = await classifyDocument(
      {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        docType,
        path: stored.storageKey,
      },
      buffer
    );
    detectedType = classification.detectedType;
    detectedNote = classification.note;
    await recordAiRun({ userId, analysisId: id, mode: "classify", ...usage });
  } catch {
    // No key, model error, unreadable file — the upload still succeeds.
  }

  const doc = await prisma.document.create({
    data: {
      analysisId: id,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      docType,
      size: file.size,
      path: stored.storageKey,
      detectedType,
      detectedNote,
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

  await deleteUpload(doc.path);
  await prisma.document.delete({ where: { id: docId } });
  return NextResponse.json({ ok: true });
}
