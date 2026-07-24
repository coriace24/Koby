// Uploaded-document storage. All file I/O for uploads goes through this module so
// that swapping local disk for S3-compatible object storage at hosting time is a
// one-file change.
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

// KOBY_DATA_DIR (set by the desktop launcher) keeps user data outside the app
// folder so updates never delete uploads. Defaults to the project dir for dev.
const UPLOAD_ROOT = path.join(process.env.KOBY_DATA_DIR || process.cwd(), "uploads");

export interface StoredFile {
  storageKey: string; // opaque key persisted in the Document.path column
}

export async function saveUpload(
  scope: string, // e.g. the analysis id
  originalName: string,
  data: Buffer
): Promise<StoredFile> {
  const safeName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, "_");
  const dir = path.join(UPLOAD_ROOT, scope);
  await fs.mkdir(dir, { recursive: true });
  const key = path.join(dir, `${crypto.randomUUID()}-${safeName}`);
  await fs.writeFile(key, data);
  return { storageKey: key };
}

export async function readUpload(storageKey: string): Promise<Buffer> {
  return fs.readFile(storageKey);
}

export async function deleteUpload(storageKey: string): Promise<void> {
  await fs.unlink(storageKey).catch(() => {});
}
