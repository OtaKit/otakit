import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { resolveOrganizationAccess } from '@/lib/organization-access';

export const runtime = 'nodejs';

type EventCountSummary = {
  downloads: number;
  applied: number;
  downloadErrors: number;
  rollbacks: number;
};

type BundleSummary = {
  version: string;
  id: string;
  createdAt: string;
  size: number;
  runtimeVersion: string | null;
  isLive: boolean;
  currentTargets: Array<{
    channel: string | null;
    runtimeVersion: string | null;
  }>;
  deployedTargets: Array<{
    channel: string | null;
    runtimeVersion: string | null;
    deployedAt: string;
  }>;
  eventCounts: EventCountSummary;
};

function createEmptyCounts(): EventCountSummary {
  return { downloads: 0, applied: 0, downloadErrors: 0, rollbacks: 0 };
}

function toTargetKey(channel: string | null, runtimeVersion: string | null): string {
  return `${channel ?? '__base__'}::${runtimeVersion ?? '__runtime_null__'}`;
}

function compareNullableStrings(a: string | null, b: string | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return -1;
  }
  if (b === null) {
    return 1;
  }
  return a.localeCompare(b);
}

function compareTargets(
  a: { channel: string | null; runtimeVersion: string | null },
  b: { channel: string | null; runtimeVersion: string | null },
): number {
  const byChannel = compareNullableStrings(a.channel, b.channel);
  if (byChannel !== 0) {
    return byChannel;
  }
  return compareNullableStrings(a.runtimeVersion, b.runtimeVersion);
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

  const bundles = await db.bundle.findMany({
    where: { appId },
    select: {
      id: true,
      version: true,
      size: true,
      createdAt: true,
      runtimeVersion: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (bundles.length === 0) {
    return NextResponse.json({ bundles: [] as BundleSummary[] });
  }

  const bundleIds = bundles.map((bundle) => bundle.id);
  const bundleById = new Map(bundles.map((bundle) => [bundle.id, bundle]));
  const versions = bundles.map((bundle) => bundle.version);
  const releases = await db.release.findMany({
    where: {
      appId,
      bundleId: { in: bundleIds },
    },
    select: {
      id: true,
      bundleId: true,
      channel: true,
      promotedAt: true,
      revertedAt: true,
    },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
  });

  const actionCounts = await db.deviceEvent.groupBy({
    by: ['bundleVersion', 'action'],
    where: {
      appId,
      bundleVersion: { in: versions },
    },
    _count: { _all: true },
  });

  const byVersion = new Map<
    string,
    {
      id: string;
      createdAt: Date;
      size: number;
      runtimeVersion: string | null;
      isLive: boolean;
      currentTargets: Map<string, { channel: string | null; runtimeVersion: string | null }>;
      deployedTargets: Map<
        string,
        { channel: string | null; runtimeVersion: string | null; deployedAt: Date }
      >;
      eventCounts: EventCountSummary;
    }
  >();

  for (const bundle of bundles) {
    if (!byVersion.has(bundle.version)) {
      byVersion.set(bundle.version, {
        id: bundle.id,
        createdAt: bundle.createdAt,
        size: bundle.size,
        runtimeVersion: bundle.runtimeVersion,
        isLive: false,
        currentTargets: new Map<string, { channel: string | null; runtimeVersion: string | null }>(),
        deployedTargets: new Map<
          string,
          { channel: string | null; runtimeVersion: string | null; deployedAt: Date }
        >(),
        eventCounts: createEmptyCounts(),
      });
    }
  }

  const latestByTarget = new Map<
    string,
    { channel: string | null; runtimeVersion: string | null; bundleId: string }
  >();

  for (const release of releases) {
    const bundle = bundleById.get(release.bundleId);
    if (!bundle) continue;

    const row = byVersion.get(bundle.version);
    if (!row) continue;

    const target = {
      channel: release.channel,
      runtimeVersion: bundle.runtimeVersion,
    };
    const targetKey = toTargetKey(target.channel, target.runtimeVersion);
    const currentRelease = row.deployedTargets.get(targetKey);
    if (!currentRelease || release.promotedAt > currentRelease.deployedAt) {
      row.deployedTargets.set(targetKey, {
        channel: target.channel,
        runtimeVersion: target.runtimeVersion,
        deployedAt: release.promotedAt,
      });
    }

    if (!latestByTarget.has(targetKey) && release.revertedAt === null) {
      latestByTarget.set(targetKey, {
        channel: target.channel,
        runtimeVersion: target.runtimeVersion,
        bundleId: release.bundleId,
      });
    }
  }

  for (const latest of latestByTarget.values()) {
    const bundle = bundleById.get(latest.bundleId);
    if (!bundle) continue;

    const row = byVersion.get(bundle.version);
    if (!row) continue;

    const targetKey = toTargetKey(latest.channel, latest.runtimeVersion);
    row.currentTargets.set(targetKey, {
      channel: latest.channel,
      runtimeVersion: latest.runtimeVersion,
    });
    if (latest.channel === null) {
      row.isLive = true;
    }
  }

  for (const entry of actionCounts) {
    const version = entry.bundleVersion;
    if (!version) continue;

    const row = byVersion.get(version);
    if (!row) continue;

    if (entry.action === 'downloaded') {
      row.eventCounts.downloads += entry._count._all;
    } else if (entry.action === 'applied') {
      row.eventCounts.applied += entry._count._all;
    } else if (entry.action === 'download_error') {
      row.eventCounts.downloadErrors += entry._count._all;
    } else if (entry.action === 'rollback') {
      row.eventCounts.rollbacks += entry._count._all;
    }
  }

  const summaries: BundleSummary[] = Array.from(byVersion.entries())
    .map(([version, row]) => {
      const currentTargets = Array.from(row.currentTargets.values()).sort(compareTargets);

      const deployedTargets = Array.from(row.deployedTargets.values())
        .map((entry) => ({
          channel: entry.channel,
          runtimeVersion: entry.runtimeVersion,
          deployedAt: entry.deployedAt.toISOString(),
        }))
        .sort(compareTargets);

      return {
        version,
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        size: row.size,
        runtimeVersion: row.runtimeVersion,
        isLive: row.isLive,
        currentTargets,
        deployedTargets,
        eventCounts: row.eventCounts,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({ bundles: summaries });
}
