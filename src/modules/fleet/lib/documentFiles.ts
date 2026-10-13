// File rules for machine documents, enforced at BOTH the presign and the create step. Pure functions.
import { randomUUID } from 'node:crypto';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_SET = 20;

/** mime -> allowed extensions. The extension and the mime type must agree. */
export const ALLOWED_FILES: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
};

export const isImageMime = (mime: string | null | undefined) => Boolean(mime && mime.startsWith('image/'));

/** Strips paths and anything that is not a plain file-name character; keeps the extension. Never returns an empty name. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return (cleaned || 'file').slice(0, 120);
}

export interface FileCheck {
  name: string;
  mimeType: string;
  sizeBytes: number;
}

/** Returns an error message, or null when the file is acceptable. */
export function checkFile(f: FileCheck): string | null {
  const allowed = ALLOWED_FILES[f.mimeType.toLowerCase()];
  if (!allowed) return `"${sanitizeFileName(f.name)}": this file type is not allowed. Use PDF, JPG, PNG, WEBP, DOCX or XLSX.`;
  const ext = /\.([A-Za-z0-9]+)$/.exec(f.name)?.[1]?.toLowerCase();
  if (!ext || !allowed.includes(ext)) return `"${sanitizeFileName(f.name)}": the file extension does not match its type.`;
  if (!Number.isFinite(f.sizeBytes) || f.sizeBytes <= 0) return `"${sanitizeFileName(f.name)}": the file is empty.`;
  if (f.sizeBytes > MAX_FILE_BYTES) return `"${sanitizeFileName(f.name)}": the file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  return null;
}

/** Per-firm and per-owner key prefix. New objects always live under it. */
export function keyPrefix(firmId: bigint | null, owner: { machineId?: string | null; ownerUserId?: bigint | null }): string {
  const firm = firmId === null ? 'none' : String(firmId);
  const who = owner.machineId ? `machine-${owner.machineId}` : `operator-${owner.ownerUserId ?? 'unknown'}`;
  return `documents/firm-${firm}/${who}/`;
}

export function newKey(prefix: string, name: string): string {
  return `${prefix}${randomUUID()}-${sanitizeFileName(name)}`;
}
