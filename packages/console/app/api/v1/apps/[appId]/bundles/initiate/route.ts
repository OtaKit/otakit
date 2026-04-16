import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { db } from '@/lib/db';
import { createPresignedUpload, getMaxBundleSize } from '@/lib/storage';
import {
  isValidMetadata,
  isValidRuntimeVersion,
  isValidVersion,
  normalizeOptionalRuntimeVersion,
  parsePositiveInteger,
} from '@/lib/validation';

export const runtime = 'nodejs';
const SHA_256_REGEX = /^[a-f0-9]{64}$/i;

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
      { error: 'runtimeVersion must be 1-64 characters using letters, numbers, dot, underscore, or dash' },
      { status: 400 },
    );
  }

  const parsedSize = parsePositiveInteger(body.size);
  if (parsedSize === null || parsedSize === undefined) {
    return NextResponse.json(
      { error: 'Missing or invalid size (must be a positive integer)' },
      { status: 400 },
    );
  }
  const size: number = parsedSize;

  const rawSha256 = body.sha256;
  if (typeof rawSha256 !== 'string' || !SHA_256_REGEX.test(rawSha256)) {
    return NextResponse.json(
      { error: 'Missing or invalid sha256 (must be a 64-char hex string)' },
      { status: 400 },
    );
  }
  const sha256 = rawSha256.toLowerCase();

  const maxBundleSize = getMaxBundleSize();
  if (size > maxBundleSize) {
    return NextResponse.json(
      { error: `Bundle too large: ${size} bytes (max ${maxBundleSize} bytes)` },
      { status: 413 },
    );
  }

  const metadata = body.metadata;
  if (!isValidMetadata(metadata)) {
    return NextResponse.json(
      { error: 'metadata must be an object (max 8KB, depth 5)' },
      { status: 400 },
    );
  }

  const existing = await db.bundle.findUnique({
    where: {
      appId_version: { appId, version },
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: `Bundle ${version} already exists` }, { status: 409 });
  }

  const uploadId = crypto.randomUUID();
  const { presignedUrl, storageKey, expiresAt } = await createPresignedUpload(
    appId,
    uploadId,
    size,
  );

  await db.uploadSession.create({
    data: {
      id: uploadId,
      appId,
      version,
      expectedSha256: sha256,
      expectedSize: size,
      runtimeVersion,
      metadata:
        metadata === null ? Prisma.JsonNull : (metadata as Prisma.InputJsonValue | undefined),
      storageKey,
      expiresAt,
    },
  });

  return NextResponse.json({
    uploadId,
    presignedUrl,
    storageKey,
    expiresAt: expiresAt.toISOString(),
  });
}
