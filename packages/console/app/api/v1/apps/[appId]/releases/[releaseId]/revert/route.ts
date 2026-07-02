import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { resolveReleaseActor } from '@/lib/release-audit';
import { revertCurrentRelease } from '@/lib/releases';

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

  const revertedBy = await resolveReleaseActor(access.access);
  const outcome = await revertCurrentRelease({
    appId,
    releaseId,
    revertedBy,
    actor: await accessActor(access.access, revertedBy),
    organizationId: access.access.organizationId,
    forceImmediate: rawForceImmediate,
  });

  if (!outcome.ok) {
    if (outcome.reason === 'not_found') {
      return NextResponse.json({ error: 'Release not found' }, { status: 404 });
    }
    if (outcome.reason === 'already_reverted') {
      return NextResponse.json({ error: 'Release is already reverted' }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Release is no longer current on this channel' },
      { status: 409 },
    );
  }

  const { targetRelease, nextCurrentRelease, revertedAt } = outcome;

  return NextResponse.json({
    release: {
      id: targetRelease.id,
      channel: targetRelease.channel,
      runtimeVersion: targetRelease.bundle.runtimeVersion,
      bundleId: targetRelease.bundleId,
      bundleVersion: targetRelease.bundle.version,
      previousBundleId: targetRelease.previousBundleId,
      previousBundleVersion: targetRelease.previousBundle?.version ?? null,
      promotedAt: targetRelease.promotedAt.toISOString(),
      promotedBy: targetRelease.promotedBy,
      revertedAt: revertedAt.toISOString(),
      revertedBy: outcome.revertedBy,
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
          forceImmediate: nextCurrentRelease.forceImmediate,
          promotedAt: nextCurrentRelease.promotedAt.toISOString(),
          promotedBy: nextCurrentRelease.promotedBy,
          revertedAt: nextCurrentRelease.revertedAt?.toISOString() ?? null,
          revertedBy: nextCurrentRelease.revertedBy,
        }
      : null,
  });
}
