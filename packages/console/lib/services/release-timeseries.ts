import type { PrismaClient } from '@prisma/client';

import type { Platform } from '@/app/components/dashboard-types';
import { AUTO_REVERT_REVERTED_BY } from '@/lib/auto-revert-alerts';
import { db } from '@/lib/db';
import { getReleaseEventTimeseries, type ReleaseEventTimeseriesPoint } from '@/lib/tinybird/events';

import { OtaKitServiceError } from './errors';
import { releaseWithBundlesInclude, toReleaseSummary, type ReleaseSummary } from './releases';

/**
 * Release health over time: client-reported events per hourly or daily bucket,
 * for the dashboard's health charts, the REST API and the MCP tool.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const RANGES = {
  '24h': { buckets: 24, bucketMs: HOUR_MS },
  '7d': { buckets: 7 * 24, bucketMs: HOUR_MS },
  '30d': { buckets: 30, bucketMs: DAY_MS },
} as const;

export type ReleaseTimeseriesRange = keyof typeof RANGES;
export const RELEASE_TIMESERIES_RANGES = Object.keys(RANGES) as ReleaseTimeseriesRange[];

/** The lane chart shows this many recent releases of the lane. */
const LANE_RELEASES = 6;
/** Releases younger than this open on the 24-hour range by default. */
const YOUNG_RELEASE_MS = 2 * DAY_MS;

export function isReleaseTimeseriesRange(value: unknown): value is ReleaseTimeseriesRange {
  return typeof value === 'string' && value in RANGES;
}

export type ReleaseTimeseriesCounts = {
  downloads: number;
  applied: number;
  downloadErrors: number;
  rollbacks: number;
};

export type ReleaseTimeseriesBucket = ReleaseTimeseriesCounts & {
  /** Bucket start (UTC). */
  start: string;
  /** Applies from the start of the range through this bucket. */
  appliedTotal: number;
};

export type ReleaseTimeseriesMarker = {
  at: string;
  type: 'released' | 'rollout' | 'reverted' | 'auto_reverted';
  label: string;
};

export type ReleaseTimeseries = {
  release: ReleaseSummary;
  range: ReleaseTimeseriesRange;
  granularity: 'hour' | 'day';
  from: string;
  to: string;
  platform: Platform | null;
  unit: 'events';
  analyticsAvailable: boolean;
  dataIntegrity: 'client_reported_unauthenticated_events';
  /** When the newest event in the range was first received. */
  lastEventAt: string | null;
  totals: ReleaseTimeseriesCounts & { rollbackSharePercent: number | null };
  buckets: ReleaseTimeseriesBucket[];
  markers: ReleaseTimeseriesMarker[];
  /** Applies per bucket for recent releases of the same lane, oldest first. */
  lane?: {
    channel: string | null;
    runtimeVersion: string | null;
    releases: Array<{
      id: string;
      bundleVersion: string;
      promotedAt: string;
      revertedAt: string | null;
      applied: number[];
    }>;
  };
};

function emptyCounts(): ReleaseTimeseriesCounts {
  return { downloads: 0, applied: 0, downloadErrors: 0, rollbacks: 0 };
}

function addPoint(counts: ReleaseTimeseriesCounts, point: ReleaseEventTimeseriesPoint): void {
  if (point.action === 'downloaded') counts.downloads += point.count;
  else if (point.action === 'applied') counts.applied += point.count;
  else if (point.action === 'download_error') counts.downloadErrors += point.count;
  else counts.rollbacks += point.count;
}

/** Rollback share as auto-revert computes it: rollbacks / (applies + rollbacks). */
function rollbackSharePercent(counts: ReleaseTimeseriesCounts): number | null {
  const attempts = counts.applied + counts.rollbacks;
  return attempts === 0 ? null : Math.round((counts.rollbacks / attempts) * 10_000) / 100;
}

export async function getReleaseTimeseries(
  input: {
    organizationId: string;
    appId: string;
    releaseId: string;
    /** Defaults to 24h for releases younger than two days, else 7d. */
    range?: ReleaseTimeseriesRange;
    platform?: Platform | null;
    /** Include recent releases of the same lane. */
    lane?: boolean;
  },
  dependencies: {
    database?: PrismaClient;
    now?: Date;
    readTimeseries?: typeof getReleaseEventTimeseries;
  } = {},
): Promise<ReleaseTimeseries> {
  const database = dependencies.database ?? db;
  const readTimeseries = dependencies.readTimeseries ?? getReleaseEventTimeseries;
  const now = (dependencies.now ?? new Date()).getTime();

  const release = await database.release.findFirst({
    where: {
      id: input.releaseId,
      appId: input.appId,
      app: { organizationId: input.organizationId },
    },
    include: releaseWithBundlesInclude,
  });
  if (!release) {
    throw new OtaKitServiceError('RELEASE_NOT_FOUND', 'Release not found', 404);
  }

  const range =
    input.range ?? (now - release.promotedAt.getTime() < YOUNG_RELEASE_MS ? '24h' : '7d');
  const { buckets: bucketCount, bucketMs } = RANGES[range];
  // Buckets are UTC hours or days; the last one is the current, partial one.
  const to = (Math.floor(now / bucketMs) + 1) * bucketMs;
  const from = to - bucketCount * bucketMs;
  const platform = input.platform ?? null;

  const laneReleases = input.lane
    ? (
        await database.release.findMany({
          where: {
            appId: input.appId,
            channel: release.channel,
            bundle: { is: { runtimeVersion: release.bundle.runtimeVersion } },
            promotedAt: { lt: new Date(to) },
            id: { not: release.id },
          },
          orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
          take: LANE_RELEASES - 1,
          include: releaseWithBundlesInclude,
        })
      )
        .concat(release)
        .sort((left, right) => left.promotedAt.getTime() - right.promotedAt.getTime())
    : [];

  const analytics = await readTimeseries({
    appId: input.appId,
    releaseIds: [release.id, ...laneReleases.map((laneRelease) => laneRelease.id)],
    from: new Date(from),
    to: new Date(to),
    daily: bucketMs === DAY_MS,
    platform,
  });

  // counts[releaseId][bucketIndex]
  const counts = new Map<string, ReleaseTimeseriesCounts[]>();
  let lastEventAt = 0;
  for (const point of analytics.data) {
    const index = Math.floor((point.bucketStart - from) / bucketMs);
    if (index < 0 || index >= bucketCount) continue;
    let series = counts.get(point.releaseId);
    if (!series) {
      series = Array.from({ length: bucketCount }, emptyCounts);
      counts.set(point.releaseId, series);
    }
    addPoint(series[index], point);
    if (point.releaseId === release.id) lastEventAt = Math.max(lastEventAt, point.lastReceivedAt);
  }

  const series = counts.get(release.id) ?? Array.from({ length: bucketCount }, emptyCounts);
  const totals = emptyCounts();
  const buckets = series.map((bucket, index) => {
    totals.downloads += bucket.downloads;
    totals.applied += bucket.applied;
    totals.downloadErrors += bucket.downloadErrors;
    totals.rollbacks += bucket.rollbacks;
    return {
      start: new Date(from + index * bucketMs).toISOString(),
      ...bucket,
      appliedTotal: totals.applied,
    };
  });

  return {
    release: toReleaseSummary(release),
    range,
    granularity: bucketMs === DAY_MS ? 'day' : 'hour',
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    platform,
    unit: 'events',
    analyticsAvailable: analytics.available,
    dataIntegrity: 'client_reported_unauthenticated_events',
    lastEventAt: lastEventAt > 0 ? new Date(lastEventAt).toISOString() : null,
    totals: { ...totals, rollbackSharePercent: rollbackSharePercent(totals) },
    buckets,
    markers: await releaseMarkers(database, input.organizationId, release, from, to),
    ...(input.lane
      ? {
          lane: {
            channel: release.channel,
            runtimeVersion: release.bundle.runtimeVersion,
            releases: laneReleases.map((laneRelease) => ({
              id: laneRelease.id,
              bundleVersion: laneRelease.bundle.version,
              promotedAt: laneRelease.promotedAt.toISOString(),
              revertedAt: laneRelease.revertedAt?.toISOString() ?? null,
              applied:
                counts.get(laneRelease.id)?.map((bucket) => bucket.applied) ??
                new Array<number>(bucketCount).fill(0),
            })),
          },
        }
      : {}),
  };
}

/** Release, rollout step and revert times within [from, to), oldest first. */
async function releaseMarkers(
  database: PrismaClient,
  organizationId: string,
  release: { id: string; promotedAt: Date; revertedAt: Date | null; revertedBy: string | null },
  from: number,
  to: number,
): Promise<ReleaseTimeseriesMarker[]> {
  const inRange = (date: Date) => date.getTime() >= from && date.getTime() < to;
  const markers: ReleaseTimeseriesMarker[] = [];
  if (inRange(release.promotedAt)) {
    markers.push({ at: release.promotedAt.toISOString(), type: 'released', label: 'Released' });
  }

  const steps = await database.auditLog.findMany({
    where: {
      organizationId,
      action: 'release.rollout_updated',
      targetId: release.id,
      createdAt: { gte: new Date(from), lt: new Date(to) },
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, metadata: true },
  });
  for (const step of steps) {
    const metadata = (step.metadata ?? {}) as { fromPercent?: unknown; toPercent?: unknown };
    if (typeof metadata.fromPercent !== 'number' || typeof metadata.toPercent !== 'number') {
      continue;
    }
    markers.push({
      at: step.createdAt.toISOString(),
      type: 'rollout',
      label:
        metadata.toPercent === 100
          ? 'Rollout complete'
          : `${metadata.fromPercent}% → ${metadata.toPercent}%`,
    });
  }

  if (release.revertedAt && inRange(release.revertedAt)) {
    const automatic = release.revertedBy === AUTO_REVERT_REVERTED_BY;
    markers.push({
      at: release.revertedAt.toISOString(),
      type: automatic ? 'auto_reverted' : 'reverted',
      label: automatic ? 'Auto-reverted' : 'Reverted',
    });
  }
  return markers.sort((left, right) => left.at.localeCompare(right.at));
}
