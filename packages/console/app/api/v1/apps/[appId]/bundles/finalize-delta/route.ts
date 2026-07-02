import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { accessActor, recordAuditLog } from '@/lib/audit-log';
import { db } from '@/lib/db';
import { computeFilesHash, type DeltaFileEntry } from '@/lib/delta-files';
import {
  BUNDLE_CACHE_CONTROL,
  buildFileObjectKey,
  putTextObject,
  statStorageObject,
} from '@/lib/storage';

export const runtime = 'nodejs';

const HEAD_CONCURRENCY = 50;

function serializeBundle(bundle: {
  id: string;
  version: string;
  sha256: string;
  size: number;
  runtimeVersion: string | null;
  strategy: string;
  createdAt: Date;
}) {
  return {
    id: bundle.id,
    version: bundle.version,
    sha256: bundle.sha256,
    size: bundle.size,
    runtimeVersion: bundle.runtimeVersion,
    strategy: bundle.strategy,
    createdAt: bundle.createdAt.toISOString(),
  };
}

const BUNDLE_SELECT = {
  id: true,
  version: true,
  sha256: true,
  size: true,
  runtimeVersion: true,
  strategy: true,
  createdAt: true,
} as const;

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

  const uploadId = body.uploadId;
  if (typeof uploadId !== 'string' || uploadId.trim().length === 0) {
    return NextResponse.json({ error: 'Missing uploadId' }, { status: 400 });
  }
  const normalizedUploadId = uploadId.trim();

  const session = await db.uploadSession.findUnique({
    where: { id: normalizedUploadId },
    include: {
      bundle: { select: BUNDLE_SELECT },
    },
  });
  if (!session) {
    return NextResponse.json({ error: 'Upload not found or expired' }, { status: 404 });
  }

  if (session.appId !== appId) {
    return NextResponse.json({ error: 'App ID mismatch' }, { status: 403 });
  }

  if (session.strategy !== 'deltas') {
    return NextResponse.json(
      { error: 'Upload session is not a delta upload; use bundles/finalize' },
      { status: 400 },
    );
  }

  if (session.status === 'finalized') {
    if (!session.bundle) {
      return NextResponse.json(
        { error: 'Upload session finalized without a bundle record' },
        { status: 409 },
      );
    }
    return NextResponse.json(serializeBundle(session.bundle));
  }

  if (session.status === 'expired' || session.expiresAt < new Date()) {
    if (session.status !== 'expired') {
      await db.uploadSession.update({
        where: { id: session.id },
        data: { status: 'expired' },
      });
    }
    return NextResponse.json({ error: 'Upload expired' }, { status: 410 });
  }

  const files = session.files as unknown as DeltaFileEntry[] | null;
  if (!Array.isArray(files) || files.length === 0) {
    return NextResponse.json({ error: 'Upload session is missing its file list' }, { status: 409 });
  }

  // Defense in depth: the stored list must still hash to what we promised.
  const filesHash = computeFilesHash(files);
  if (filesHash !== session.expectedSha256) {
    return NextResponse.json(
      { error: 'Upload session file list does not match its filesHash' },
      { status: 409 },
    );
  }

  // Verify every unique content object exists with the expected size.
  const uniqueEntries = new Map<string, number>();
  for (const file of files) {
    uniqueEntries.set(file.sha256, file.size);
  }
  const entries = [...uniqueEntries.entries()];
  for (let index = 0; index < entries.length; index += HEAD_CONCURRENCY) {
    const chunk = entries.slice(index, index + HEAD_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async ([sha256, size]) => {
        const stat = await statStorageObject(buildFileObjectKey(appId, sha256));
        if (stat === null) {
          return `Missing uploaded file object: ${sha256}`;
        }
        if (stat.size !== size) {
          return `Size mismatch for ${sha256}: expected ${size} bytes, got ${stat.size} bytes`;
        }
        return null;
      }),
    );
    const failure = results.find((result) => result !== null);
    if (failure) {
      return NextResponse.json({ error: failure }, { status: 400 });
    }
  }

  // Persist the canonical file list as the bundle's storage object.
  await putTextObject({
    storageKey: session.storageKey,
    body: JSON.stringify({
      version: session.version,
      filesHash,
      files,
    }),
    contentType: 'application/json; charset=utf-8',
    cacheControl: BUNDLE_CACHE_CONTROL,
  });

  const totalSize = session.expectedSize;

  try {
    const bundle = await db.$transaction(async (tx) => {
      const createdBundle = await tx.bundle.create({
        data: {
          appId: session.appId,
          version: session.version,
          sha256: filesHash,
          storageKey: session.storageKey,
          size: totalSize,
          runtimeVersion: session.runtimeVersion,
          strategy: 'deltas',
        },
        select: BUNDLE_SELECT,
      });

      await tx.uploadSession.update({
        where: { id: session.id },
        data: {
          status: 'finalized',
          actualSize: totalSize,
          finalizedAt: new Date(),
          bundleId: createdBundle.id,
        },
      });

      return createdBundle;
    });

    await recordAuditLog({
      organizationId: access.access.organizationId,
      actor: await accessActor(access.access),
      action: 'bundle.uploaded',
      targetType: 'bundle',
      targetId: bundle.id,
      metadata: {
        appId,
        version: bundle.version,
        size: bundle.size,
        runtimeVersion: bundle.runtimeVersion,
        strategy: 'deltas',
      },
    });

    return NextResponse.json(serializeBundle(bundle), { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existingBundle = await db.bundle.findUnique({
        where: {
          appId_version: {
            appId: session.appId,
            version: session.version,
          },
        },
        select: BUNDLE_SELECT,
      });

      if (existingBundle) {
        await db.uploadSession
          .update({
            where: { id: session.id },
            data: {
              status: 'finalized',
              actualSize: totalSize,
              finalizedAt: new Date(),
              bundleId: existingBundle.id,
            },
          })
          .catch(() => undefined);

        return NextResponse.json(serializeBundle(existingBundle));
      }

      return NextResponse.json(
        { error: 'Bundle with this app/version already exists' },
        { status: 409 },
      );
    }

    const message = error instanceof Error ? error.message : 'Finalize failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
