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
  isLive: boolean;
  currentChannels: Array<string | null>;
  deployedChannels: Array<{
    channel: string | null;
    deployedAt: string;
  }>;
  eventCounts: EventCountSummary;
};

function createEmptyCounts(): EventCountSummary {
  return { downloads: 0, applied: 0, downloadErrors: 0, rollbacks: 0 };
}

function toChannelKey(channel: string | null): string {
  return channel ?? '__base__';
}

function compareChannels(a: string | null, b: string | null): number {
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
      isLive: boolean;
      currentChannels: Map<string, string | null>;
      deployedChannels: Map<string, { channel: string | null; deployedAt: Date }>;
      eventCounts: EventCountSummary;
    }
  >();

  for (const bundle of bundles) {
    if (!byVersion.has(bundle.version)) {
      byVersion.set(bundle.version, {
        id: bundle.id,
        createdAt: bundle.createdAt,
        size: bundle.size,
        isLive: false,
        currentChannels: new Map<string, string | null>(),
        deployedChannels: new Map<string, { channel: string | null; deployedAt: Date }>(),
        eventCounts: createEmptyCounts(),
      });
    }
  }

  const latestByChannel = new Map<string, { channel: string | null; bundleId: string }>();

  for (const release of releases) {
    const bundle = bundleById.get(release.bundleId);
    if (!bundle) continue;

    const row = byVersion.get(bundle.version);
    if (!row) continue;

    const channelKey = toChannelKey(release.channel);
    const currentRelease = row.deployedChannels.get(channelKey);
    if (!currentRelease || release.promotedAt > currentRelease.deployedAt) {
      row.deployedChannels.set(channelKey, {
        channel: release.channel,
        deployedAt: release.promotedAt,
      });
    }

    if (!latestByChannel.has(channelKey) && release.revertedAt === null) {
      latestByChannel.set(channelKey, {
        channel: release.channel,
        bundleId: release.bundleId,
      });
    }
  }

  for (const latest of latestByChannel.values()) {
    const bundle = bundleById.get(latest.bundleId);
    if (!bundle) continue;

    const row = byVersion.get(bundle.version);
    if (!row) continue;

    const channelKey = toChannelKey(latest.channel);
    row.currentChannels.set(channelKey, latest.channel);
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
      const currentChannels = Array.from(row.currentChannels.values()).sort(compareChannels);

      const deployedChannels = Array.from(row.deployedChannels.values())
        .map((entry) => ({
          channel: entry.channel,
          deployedAt: entry.deployedAt.toISOString(),
        }))
        .sort((a, b) => compareChannels(a.channel, b.channel));

      return {
        version,
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        size: row.size,
        isLive: row.isLive,
        currentChannels,
        deployedChannels,
        eventCounts: row.eventCounts,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({ bundles: summaries });
}
