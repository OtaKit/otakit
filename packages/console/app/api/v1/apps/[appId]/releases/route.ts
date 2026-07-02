import { NextRequest, NextResponse } from 'next/server';

import { accessActor, recordAuditLog } from '@/lib/audit-log';
import { db } from '@/lib/db';
import { syncManifestFileForLane } from '@/lib/manifest-files';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { resolveReleaseActor } from '@/lib/release-audit';
import { createRelease } from '@/lib/releases';
import { createEmptyEventCounts, getReleaseEventCounts } from '@/lib/tinybird/events';
import {
  isValidChannelName,
  normalizeOptionalChannel,
  parseNonNegativeInteger,
} from '@/lib/validation';

export const runtime = 'nodejs';

function resolveChannelFilter(request: NextRequest): {
  present: boolean;
  value: string | null;
  invalid: boolean;
} {
  const searchParams = request.nextUrl.searchParams;
  if (!searchParams.has('channel')) {
    return { present: false, value: null, invalid: false };
  }

  const rawChannel = searchParams.get('channel');
  const channel = normalizeOptionalChannel(rawChannel);
  const invalid =
    typeof rawChannel === 'string' &&
    rawChannel.trim().length > 0 &&
    (!channel || !isValidChannelName(channel));

  return {
    present: true,
    value: channel,
    invalid,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const routeParams = await params;
  const appId = routeParams.appId;

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const channelFilter = resolveChannelFilter(request);
  if (channelFilter.invalid) {
    return NextResponse.json({ error: 'Invalid channel filter' }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(parseNonNegativeInteger(searchParams.get('limit'), 100), 200);
  const offset = parseNonNegativeInteger(searchParams.get('offset'), 0);

  const where = channelFilter.present ? { appId, channel: channelFilter.value } : { appId };

  const [releases, total] = await Promise.all([
    db.release.findMany({
      where,
      orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
      include: {
        bundle: { select: { version: true, runtimeVersion: true } },
        previousBundle: { select: { version: true } },
      },
    }),
    db.release.count({ where }),
  ]);

  const releaseIds = releases.map((release) => release.id);
  const countsByReleaseId = await getReleaseEventCounts(appId, releaseIds);

  return NextResponse.json({
    releases: releases.map((release) => ({
      id: release.id,
      channel: release.channel,
      runtimeVersion: release.bundle.runtimeVersion,
      bundleId: release.bundleId,
      bundleVersion: release.bundle.version,
      previousBundleId: release.previousBundleId,
      previousBundleVersion: release.previousBundle?.version ?? null,
      forceImmediate: release.forceImmediate,
      autoRevert: release.autoRevert,
      autoRevertRatePercent: release.autoRevertRatePercent,
      autoRevertMinSample: release.autoRevertMinSample,
      promotedAt: release.promotedAt.toISOString(),
      promotedBy: release.promotedBy,
      revertedAt: release.revertedAt?.toISOString() ?? null,
      revertedBy: release.revertedBy,
      eventCounts: countsByReleaseId.get(release.id) ?? createEmptyEventCounts(),
    })),
    total,
  });
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

  const rawBundleId = body.bundleId;
  if (typeof rawBundleId !== 'string' || rawBundleId.trim().length === 0) {
    return NextResponse.json({ error: 'Missing bundleId' }, { status: 400 });
  }
  const bundleId = rawBundleId.trim();

  const rawChannel = body.channel;
  if (rawChannel !== undefined && rawChannel !== null && typeof rawChannel !== 'string') {
    return NextResponse.json({ error: 'Invalid channel' }, { status: 400 });
  }

  const channel = normalizeOptionalChannel(rawChannel);
  if (
    typeof rawChannel === 'string' &&
    rawChannel.trim().length > 0 &&
    (!channel || !isValidChannelName(channel))
  ) {
    return NextResponse.json({ error: 'Invalid channel' }, { status: 400 });
  }

  const rawForceImmediate = body.forceImmediate;
  if (rawForceImmediate !== undefined && typeof rawForceImmediate !== 'boolean') {
    return NextResponse.json({ error: 'forceImmediate must be a boolean' }, { status: 400 });
  }
  const forceImmediate = rawForceImmediate === true;

  const rawAutoRevert = body.autoRevert;
  if (rawAutoRevert !== undefined && typeof rawAutoRevert !== 'boolean') {
    return NextResponse.json({ error: 'autoRevert must be a boolean' }, { status: 400 });
  }
  const autoRevert = rawAutoRevert === true;

  const rawAutoRevertRatePercent = body.autoRevertRatePercent;
  const rawAutoRevertMinSample = body.autoRevertMinSample;
  if (!autoRevert && (rawAutoRevertRatePercent !== undefined || rawAutoRevertMinSample !== undefined)) {
    return NextResponse.json(
      { error: 'autoRevert thresholds require autoRevert to be true' },
      { status: 400 },
    );
  }
  if (
    rawAutoRevertRatePercent !== undefined &&
    (typeof rawAutoRevertRatePercent !== 'number' ||
      !Number.isInteger(rawAutoRevertRatePercent) ||
      rawAutoRevertRatePercent < 1 ||
      rawAutoRevertRatePercent > 95)
  ) {
    return NextResponse.json(
      { error: 'autoRevertRatePercent must be an integer between 1 and 95' },
      { status: 400 },
    );
  }
  if (
    rawAutoRevertMinSample !== undefined &&
    (typeof rawAutoRevertMinSample !== 'number' ||
      !Number.isInteger(rawAutoRevertMinSample) ||
      rawAutoRevertMinSample < 10 ||
      rawAutoRevertMinSample > 100000)
  ) {
    return NextResponse.json(
      { error: 'autoRevertMinSample must be an integer between 10 and 100000' },
      { status: 400 },
    );
  }
  const autoRevertRatePercent =
    typeof rawAutoRevertRatePercent === 'number' ? rawAutoRevertRatePercent : undefined;
  const autoRevertMinSample =
    typeof rawAutoRevertMinSample === 'number' ? rawAutoRevertMinSample : undefined;

  const bundle = await db.bundle.findUnique({
    where: { id: bundleId },
    select: { id: true, appId: true, version: true, runtimeVersion: true },
  });
  if (!bundle || bundle.appId !== appId) {
    return NextResponse.json({ error: 'Bundle not found' }, { status: 404 });
  }

  const currentLatest = await db.release.findFirst({
    where: {
      appId,
      channel,
      revertedAt: null,
      bundle: {
        is: {
          runtimeVersion: bundle.runtimeVersion,
        },
      },
    },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    include: { bundle: { select: { version: true, runtimeVersion: true } } },
  });

  if (currentLatest?.bundleId === bundle.id) {
    return NextResponse.json(
      { error: 'Bundle is already current for this release channel' },
      { status: 409 },
    );
  }

  const promotedBy = await resolveReleaseActor(access.access);
  const release = await createRelease(db, {
    appId,
    bundleId: bundle.id,
    previousBundleId: currentLatest?.bundleId ?? null,
    channel,
    forceImmediate,
    autoRevert,
    autoRevertRatePercent,
    autoRevertMinSample,
    promotedBy,
  });
  await syncManifestFileForLane(appId, channel, bundle.runtimeVersion);

  await recordAuditLog({
    organizationId: access.access.organizationId,
    actor: await accessActor(access.access, promotedBy),
    action: 'release.created',
    targetType: 'release',
    targetId: release.id,
    metadata: {
      appId,
      bundleVersion: bundle.version,
      runtimeVersion: bundle.runtimeVersion,
      channel,
      forceImmediate,
      autoRevert,
      ...(autoRevert
        ? {
            autoRevertRatePercent: release.autoRevertRatePercent,
            autoRevertMinSample: release.autoRevertMinSample,
          }
        : {}),
      previousBundleVersion: currentLatest?.bundle.version ?? null,
    },
  });

  return NextResponse.json({
    release: {
      id: release.id,
      channel: release.channel,
      runtimeVersion: bundle.runtimeVersion,
      bundleId: release.bundleId,
      bundleVersion: bundle.version,
      previousBundleId: release.previousBundleId,
      forceImmediate: release.forceImmediate,
      autoRevert: release.autoRevert,
      autoRevertRatePercent: release.autoRevertRatePercent,
      autoRevertMinSample: release.autoRevertMinSample,
      promotedAt: release.promotedAt.toISOString(),
      promotedBy: release.promotedBy,
      revertedAt: null,
      revertedBy: null,
    },
    previousRelease: currentLatest
      ? {
          id: currentLatest.id,
          channel: currentLatest.channel,
          runtimeVersion: currentLatest.bundle.runtimeVersion,
          bundleId: currentLatest.bundleId,
          bundleVersion: currentLatest.bundle.version,
          promotedAt: currentLatest.promotedAt.toISOString(),
          promotedBy: currentLatest.promotedBy,
        }
      : null,
  });
}
