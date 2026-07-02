import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { db } from '@/lib/db';
import {
  computeFilesHash,
  parseDeltaFiles,
  uniqueHashes,
  type DeltaFileEntry,
} from '@/lib/delta-files';
import { buildFileObjectKey, createPresignedFileUpload, statStorageObject } from '@/lib/storage';
import {
  isValidRuntimeVersion,
  isValidVersion,
  normalizeOptionalRuntimeVersion,
} from '@/lib/validation';

export const runtime = 'nodejs';

const HEAD_CONCURRENCY = 50;

async function mapChunked<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const chunk = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(chunk.map(fn))));
  }
  return results;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const routeParams = await params;
  const appId = routeParams.appId;

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawVersion = body.version;
  if (typeof rawVersion !== 'string' || rawVersion.trim().length === 0) {
    return NextResponse.json({ error: 'Missing version' }, { status: 400 });
  }
  const version = rawVersion.trim();
  if (!isValidVersion(version)) {
    return NextResponse.json({ error: 'Version must be 1-64 characters' }, { status: 400 });
  }

  if (
    body.runtimeVersion !== undefined &&
    body.runtimeVersion !== null &&
    typeof body.runtimeVersion !== 'string'
  ) {
    return NextResponse.json({ error: 'runtimeVersion must be a string' }, { status: 400 });
  }
  const runtimeVersion = normalizeOptionalRuntimeVersion(body.runtimeVersion);
  if (
    typeof body.runtimeVersion === 'string' &&
    body.runtimeVersion.trim().length > 0 &&
    (!runtimeVersion || !isValidRuntimeVersion(runtimeVersion))
  ) {
    return NextResponse.json(
      {
        error:
          'runtimeVersion must be 1-64 characters using letters, numbers, dot, underscore, or dash',
      },
      { status: 400 },
    );
  }

  const parsed = parseDeltaFiles(body.files);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const files: DeltaFileEntry[] = parsed.files;

  const existing = await db.bundle.findUnique({
    where: {
      appId_version: { appId, version },
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: `Bundle ${version} already exists` }, { status: 409 });
  }

  // Presign PUTs only for content hashes not already in storage (dedup).
  const hashes = [...uniqueHashes(files).entries()];
  const missing = await mapChunked(hashes, HEAD_CONCURRENCY, async ([sha256, size]) => {
    const stat = await statStorageObject(buildFileObjectKey(appId, sha256));
    if (stat !== null && stat.size === size) {
      return null;
    }
    return { sha256, size };
  });

  let expiresAt: Date | null = null;
  const uploads: { sha256: string; presignedUrl: string }[] = [];
  for (const entry of missing) {
    if (!entry) continue;
    const md5 = parsed.md5ByHash.get(entry.sha256);
    if (!md5) {
      return NextResponse.json({ error: `Missing md5 for hash ${entry.sha256}` }, { status: 400 });
    }
    const presigned = await createPresignedFileUpload(
      buildFileObjectKey(appId, entry.sha256),
      entry.size,
      md5,
    );
    uploads.push({ sha256: entry.sha256, presignedUrl: presigned.presignedUrl });
    expiresAt = presigned.expiresAt;
  }

  const uploadId = crypto.randomUUID();
  const filesHash = computeFilesHash(files);
  const totalSize = parsed.totalSize;
  const storageKey = `bundles/${appId}/${uploadId}.files.json`;
  const sessionExpiresAt = expiresAt ?? new Date(Date.now() + 3600 * 1000);

  await db.uploadSession.create({
    data: {
      id: uploadId,
      appId,
      version,
      expectedSha256: filesHash,
      expectedSize: totalSize,
      runtimeVersion,
      strategy: 'deltas',
      files: files as unknown as Prisma.InputJsonValue,
      storageKey,
      expiresAt: sessionExpiresAt,
    },
  });

  return NextResponse.json({
    uploadId,
    filesHash,
    uploads,
    expiresAt: sessionExpiresAt.toISOString(),
  });
}
