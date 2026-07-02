import { NextRequest, NextResponse } from 'next/server';

import { accessActor, recordAuditLog } from '@/lib/audit-log';
import { db } from '@/lib/db';
import { syncManifestFileForLane } from '@/lib/manifest-files';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { resolveReleaseActor } from '@/lib/release-audit';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; releaseId: string }> },
) {
  const routeParams = await params;
  const appId = routeParams.appId;
  const releaseId = routeParams.releaseId;

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // The body is optional (existing clients POST without one); when present it
  // may carry a forceImmediate override for the release that becomes current.
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const rawForceImmediate = body.forceImmediate;
  if (rawForceImmediate !== undefined && typeof rawForceImmediate !== 'boolean') {
    return NextResponse.json({ error: 'forceImmediate must be a boolean' }, { status: 400 });
  }

  const targetRelease = await db.release.findFirst({
    where: { id: releaseId, appId },
    include: {
      bundle: { select: { version: true, runtimeVersion: true } },
      previousBundle: { select: { version: true } },
    },
  });

  if (!targetRelease) {
    return NextResponse.json({ error: 'Release not found' }, { status: 404 });
  }

  if (targetRelease.revertedAt !== null) {
    return NextResponse.json({ error: 'Release is already reverted' }, { status: 409 });
  }

  const currentRelease = await db.release.findFirst({
    where: {
      appId,
      channel: targetRelease.channel,
      revertedAt: null,
      bundle: {
        is: {
          runtimeVersion: targetRelease.bundle.runtimeVersion,
        },
      },
    },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });

  if (!currentRelease || currentRelease.id !== targetRelease.id) {
    return NextResponse.json(
      { error: 'Release is no longer current on this channel' },
      { status: 409 },
    );
  }

  const revertedBy = await resolveReleaseActor(access.access);
  const revertedAt = new Date();

  const [revertedRelease, nextCurrentRelease] = await db.$transaction([
    db.release.update({
      where: { id: targetRelease.id },
      data: { revertedAt, revertedBy },
    }),
    db.release.findFirst({
      where: {
        appId,
        channel: targetRelease.channel,
        revertedAt: null,
        bundle: {
          is: {
            runtimeVersion: targetRelease.bundle.runtimeVersion,
          },
        },
      },
      orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
      include: {
        bundle: { select: { version: true, runtimeVersion: true } },
        previousBundle: { select: { version: true } },
      },
    }),
  ]);

  let effectiveNextCurrentRelease = nextCurrentRelease;
  if (rawForceImmediate !== undefined && nextCurrentRelease) {
    effectiveNextCurrentRelease = await db.release.update({
      where: { id: nextCurrentRelease.id },
      data: { forceImmediate: rawForceImmediate },
      include: {
        bundle: { select: { version: true, runtimeVersion: true } },
        previousBundle: { select: { version: true } },
      },
    });
  }

  await syncManifestFileForLane(appId, targetRelease.channel, targetRelease.bundle.runtimeVersion);

  await recordAuditLog({
    organizationId: access.access.organizationId,
    actor: await accessActor(access.access, revertedBy),
    action: 'release.reverted',
    targetType: 'release',
    targetId: targetRelease.id,
    metadata: {
      appId,
      channel: targetRelease.channel,
      bundleVersion: targetRelease.bundle.version,
      runtimeVersion: targetRelease.bundle.runtimeVersion,
    },
  });

  return NextResponse.json({
    release: {
      id: revertedRelease.id,
      channel: revertedRelease.channel,
      runtimeVersion: targetRelease.bundle.runtimeVersion,
      bundleId: revertedRelease.bundleId,
      bundleVersion: targetRelease.bundle.version,
      previousBundleId: revertedRelease.previousBundleId,
      previousBundleVersion: targetRelease.previousBundle?.version ?? null,
      promotedAt: revertedRelease.promotedAt.toISOString(),
      promotedBy: revertedRelease.promotedBy,
      revertedAt: revertedAt.toISOString(),
      revertedBy,
    },
    currentRelease: effectiveNextCurrentRelease
      ? {
          id: effectiveNextCurrentRelease.id,
          channel: effectiveNextCurrentRelease.channel,
          runtimeVersion: effectiveNextCurrentRelease.bundle.runtimeVersion,
          bundleId: effectiveNextCurrentRelease.bundleId,
          bundleVersion: effectiveNextCurrentRelease.bundle.version,
          previousBundleId: effectiveNextCurrentRelease.previousBundleId,
          previousBundleVersion: effectiveNextCurrentRelease.previousBundle?.version ?? null,
          forceImmediate: effectiveNextCurrentRelease.forceImmediate,
          promotedAt: effectiveNextCurrentRelease.promotedAt.toISOString(),
          promotedBy: effectiveNextCurrentRelease.promotedBy,
          revertedAt: effectiveNextCurrentRelease.revertedAt?.toISOString() ?? null,
          revertedBy: effectiveNextCurrentRelease.revertedBy,
        }
      : null,
  });
}
