import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { db } from '@/lib/db';
import { inspectUploadedObject, UploadedObjectNotFoundError } from '@/lib/storage';

export const runtime = 'nodejs';

function serializeBundle(bundle: {
  id: string;
  version: string;
  sha256: string;
  size: number;
  minNativeBuild: number | null;
  createdAt: Date;
}) {
  return {
    id: bundle.id,
    version: bundle.version,
    sha256: bundle.sha256,
    size: bundle.size,
    minNativeBuild: bundle.minNativeBuild,
    createdAt: bundle.createdAt.toISOString(),
  };
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

  const uploadId = body.uploadId;

  if (typeof uploadId !== 'string' || uploadId.trim().length === 0) {
    return NextResponse.json({ error: 'Missing uploadId' }, { status: 400 });
  }
  const normalizedUploadId = uploadId.trim();

  const session = await db.uploadSession.findUnique({
    where: { id: normalizedUploadId },
    include: {
      bundle: {
        select: {
          id: true,
          version: true,
          sha256: true,
          size: true,
          minNativeBuild: true,
          createdAt: true,
        },
      },
    },
  });
  if (!session) {
    return NextResponse.json({ error: 'Upload not found or expired' }, { status: 404 });
  }

  if (session.appId !== appId) {
    return NextResponse.json({ error: 'App ID mismatch' }, { status: 403 });
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

  let uploadInfo: { size: number };
  try {
    uploadInfo = await inspectUploadedObject(session.storageKey);
  } catch (error) {
    if (error instanceof UploadedObjectNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Upload inspection failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (uploadInfo.size !== session.expectedSize) {
    return NextResponse.json(
      {
        error: `Uploaded size mismatch: expected ${session.expectedSize} bytes, got ${uploadInfo.size} bytes`,
      },
      { status: 400 },
    );
  }

  try {
    const bundle = await db.$transaction(async (tx) => {
      const createdBundle = await tx.bundle.create({
        data: {
          appId: session.appId,
          version: session.version,
          sha256: session.expectedSha256,
          storageKey: session.storageKey,
          size: uploadInfo.size,
          minNativeBuild: session.minNativeBuild,
          metadata:
            session.metadata === null
              ? Prisma.JsonNull
              : (session.metadata as Prisma.InputJsonValue),
        },
      });

      await tx.uploadSession.update({
        where: { id: session.id },
        data: {
          status: 'finalized',
          actualSize: uploadInfo.size,
          finalizedAt: new Date(),
          bundleId: createdBundle.id,
        },
      });

      return createdBundle;
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
        select: {
          id: true,
          version: true,
          sha256: true,
          size: true,
          minNativeBuild: true,
          createdAt: true,
        },
      });

      if (existingBundle) {
        await db.uploadSession
          .update({
            where: { id: session.id },
            data: {
              status: 'finalized',
              actualSize: uploadInfo.size,
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
