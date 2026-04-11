import { NextRequest, NextResponse } from 'next/server';

import { invalidateManifestReleaseCache } from '@/lib/cache/manifest-cache';
import { db } from '@/lib/db';
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

  await invalidateManifestReleaseCache(
    appId,
    targetRelease.channel,
    targetRelease.bundle.runtimeVersion,
  );

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
    currentRelease: nextCurrentRelease
      ? {
          id: nextCurrentRelease.id,
          channel: nextCurrentRelease.channel,
          runtimeVersion: nextCurrentRelease.bundle.runtimeVersion,
          bundleId: nextCurrentRelease.bundleId,
          bundleVersion: nextCurrentRelease.bundle.version,
          previousBundleId: nextCurrentRelease.previousBundleId,
          previousBundleVersion: nextCurrentRelease.previousBundle?.version ?? null,
          promotedAt: nextCurrentRelease.promotedAt.toISOString(),
          promotedBy: nextCurrentRelease.promotedBy,
          revertedAt: nextCurrentRelease.revertedAt?.toISOString() ?? null,
          revertedBy: nextCurrentRelease.revertedBy,
        }
      : null,
  });
}
