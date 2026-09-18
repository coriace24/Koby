// Uploaded-document storage. All file I/O for uploads goes through this module so
// that swapping local disk for S3-compatible object storage at hosting time is a
// one-file change.
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

// KOBY_DATA_DIR (set by the desktop launcher) keeps user data outside the app
// folder so updates never delete uploads. Defaults to the project dir for dev.
const STORAGE_ROOT = process.env.KOBY_DATA_DIR || process.cwd();

export interface StoredFile {
  storageKey: string; // opaque key persisted in the Document.path column
}

// Keys are stored RELATIVE to the storage root (with forward slashes) so a
// portable install keeps working when its folder moves to another PC or drive.
// Absolute keys written by earlier versions still resolve as-is.
function resolveKey(storageKey: string): string {
  return path.isAbsolute(storageKey) ? storageKey : path.join(STORAGE_ROOT, storageKey);
}

export async function saveUpload(
  scope: string, // e.g. the analysis id
  originalName: string,
  data: Buffer
): Promise<StoredFile> {
  const safeName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = ["uploads", scope, `${crypto.randomUUID()}-${safeName}`].join("/");
  const target = resolveKey(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  return { storageKey: key };
}

export async function readUpload(storageKey: string): Promise<Buffer> {
  return fs.readFile(resolveKey(storageKey));
}

export async function deleteUpload(storageKey: string): Promise<void> {
  await fs.unlink(resolveKey(storageKey)).catch(() => {});
}
