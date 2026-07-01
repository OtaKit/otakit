import crypto from 'node:crypto';

import { getMaxBundleSize } from '@/lib/storage';

/**
 * Delta strategy file list: validation + canonical hash.
 *
 * The canonical file list is the signed identity of a delta bundle:
 *   - entries sorted by path, compared as UTF-8 byte sequences
 *   - one line per file: `<path>:<sha256 lowercase hex>`
 *   - lines joined with "\n", no trailing newline
 *   - filesHash = sha256 hex of the UTF-8 canonical string
 *
 * The native plugins (DeltaAssembler.swift / DeltaAssembler.java) recompute
 * this exact string from the manifest's files[] and compare it against the
 * signed manifest sha256. Any change here must change all three together.
 */

export const MAX_DELTA_FILES = 5000;
export const MAX_DELTA_PATH_LENGTH = 512;

const SHA_256_REGEX = /^[a-f0-9]{64}$/i;

export interface DeltaFileEntry {
  path: string;
  sha256: string;
  size: number;
}

export type DeltaFilesParseResult =
  | { ok: true; files: DeltaFileEntry[]; totalSize: number }
  | { ok: false; error: string };

function isValidDeltaPath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_DELTA_PATH_LENGTH) {
    return false;
  }
  if (path.startsWith('/') || path.includes('\\')) {
    return false;
  }
  for (const segment of path.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..') {
      return false;
    }
  }
  for (const char of path) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  return true;
}

export function parseDeltaFiles(raw: unknown): DeltaFilesParseResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'files must be a non-empty array' };
  }
  if (raw.length > MAX_DELTA_FILES) {
    return { ok: false, error: `Too many files: ${raw.length} (max ${MAX_DELTA_FILES})` };
  }

  const files: DeltaFileEntry[] = [];
  const seenPaths = new Set<string>();
  const sizeByHash = new Map<string, number>();
  let totalSize = 0;

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, error: 'Each file entry must be an object' };
    }
    const { path, sha256, size } = entry as Record<string, unknown>;

    if (typeof path !== 'string' || !isValidDeltaPath(path)) {
      return { ok: false, error: `Invalid file path: ${String(path)}` };
    }
    if (seenPaths.has(path)) {
      return { ok: false, error: `Duplicate file path: ${path}` };
    }
    seenPaths.add(path);

    if (typeof sha256 !== 'string' || !SHA_256_REGEX.test(sha256)) {
      return { ok: false, error: `Invalid sha256 for ${path}` };
    }
    const normalizedSha = sha256.toLowerCase();

    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
      return { ok: false, error: `Invalid size for ${path}` };
    }

    const existingSize = sizeByHash.get(normalizedSha);
    if (existingSize !== undefined && existingSize !== size) {
      return { ok: false, error: `Conflicting sizes for content hash ${normalizedSha}` };
    }
    sizeByHash.set(normalizedSha, size);

    totalSize += size;
    files.push({ path, sha256: normalizedSha, size });
  }

  if (!seenPaths.has('index.html')) {
    return { ok: false, error: 'files must include index.html at the bundle root' };
  }

  const maxBundleSize = getMaxBundleSize();
  if (totalSize > maxBundleSize) {
    return {
      ok: false,
      error: `Bundle too large: ${totalSize} bytes (max ${maxBundleSize} bytes)`,
    };
  }

  return { ok: true, files, totalSize };
}

function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
}

export function buildCanonicalFileList(files: DeltaFileEntry[]): string {
  return files
    .slice()
    .sort((a, b) => compareUtf8(a.path, b.path))
    .map((file) => `${file.path}:${file.sha256}`)
    .join('\n');
}

export function computeFilesHash(files: DeltaFileEntry[]): string {
  return crypto.createHash('sha256').update(buildCanonicalFileList(files), 'utf-8').digest('hex');
}

/** Unique content hashes with their sizes (upload/verification unit). */
export function uniqueHashes(files: DeltaFileEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const file of files) {
    map.set(file.sha256, file.size);
  }
  return map;
}
