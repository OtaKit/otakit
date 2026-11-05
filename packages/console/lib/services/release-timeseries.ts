import type { Prisma, PrismaClient } from '@prisma/client';

import type { Platform } from '@/app/components/dashboard-types';
import { AUTO_REVERT_REVERTED_BY } from '@/lib/auto-revert-alerts';
import { db } from '@/lib/db';
import {
  getReleaseEventTimeseries,
  MAX_TIMESERIES_RELEASES,
  type ReleaseEventTimeseriesPoint,
} from '@/lib/tinybird/events';

import { OtaKitServiceError } from './errors';
import {
  releaseWithBundlesInclude,
  ROLLOUT_REPLACED_BY,
  toReleaseSummary,
  type ReleaseSummary,
} from './releases';

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

/** The lane chart shows at most this many releases, the viewed one included. */
const LANE_RELEASES = 8;
/** How far back before the range to look for the releases devices could fall back to. */
const LANE_CANDIDATES = 50;
/** Releases younger than this open on the 24-hour range by default. */
const YOUNG_RELEASE_MS = 2 * DAY_MS;

export function isReleaseTimeseriesRange(value: unknown): value is ReleaseTimeseriesRange {
  // Own keys only: `in` would also accept "toString" or "constructor".
  return typeof value === 'string' && Object.hasOwn(RANGES, value);
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
  /** When the series was computed; the last bucket ends after it. */
  asOf: string;
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

  const lane = input.lane ? await laneReleases(database, release, from, to) : [];

  const [analytics, markers] = await Promise.all([
    readTimeseries({
      appId: input.appId,
      // The lane includes the release itself.
      releaseIds: input.lane ? lane.map((laneRelease) => laneRelease.id) : [release.id],
      from: new Date(from),
      to: new Date(to),
      daily: bucketMs === DAY_MS,
      platform,
    }),
    releaseMarkers(database, input.organizationId, release, from, to),
  ]);

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
    asOf: new Date(now).toISOString(),
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    platform,
    unit: 'events',
    analyticsAvailable: analytics.available,
    dataIntegrity: 'client_reported_unauthenticated_events',
    lastEventAt: lastEventAt > 0 ? new Date(lastEventAt).toISOString() : null,
    totals: { ...totals, rollbackSharePercent: rollbackSharePercent(totals) },
    buckets,
    markers,
    ...(input.lane
      ? {
          lane: {
            channel: release.channel,
            runtimeVersion: release.bundle.runtimeVersion,
            releases: lane.map((laneRelease) => ({
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

const laneReleaseSelect = {
  id: true,
  promotedAt: true,
  revertedAt: true,
  rolloutPercent: true,
  bundle: { select: { version: true } },
} satisfies Prisma.ReleaseSelect;

type LaneRelease = Prisma.ReleaseGetPayload<{ select: typeof laneReleaseSelect }>;

const byPromotion = (left: LaneRelease, right: LaneRelease) =>
  left.promotedAt.getTime() - right.promotedAt.getTime() || left.id.localeCompare(right.id);

/**
 * The releases of the viewed release's lane (same channel and runtime) that can
 * have applies in [from, to), oldest first, and at most the chart's size of
 * them, nearest the viewed release. Those are the releases promoted during the
 * range, the one live when it starts, and whatever devices fell back to below
 * it: through a revert within the range, or the stable release a rollout
 * shares devices with.
 */
async function laneReleases(
  database: PrismaClient,
  release: LaneRelease & {
    appId: string;
    channel: string | null;
    bundle: { runtimeVersion: string | null };
  },
  from: number,
  to: number,
): Promise<LaneRelease[]> {
  const size = Math.min(LANE_RELEASES, MAX_TIMESERIES_RELEASES);
  const lane = {
    appId: release.appId,
    channel: release.channel,
    bundle: { is: { runtimeVersion: release.bundle.runtimeVersion } },
    id: { not: release.id },
  } satisfies Prisma.ReleaseWhereInput;
  const promoted = release.promotedAt.getTime();
  const [earlierInRange, laterInRange, beforeRange] = await Promise.all([
    promoted > from
      ? database.release.findMany({
          where: { ...lane, promotedAt: { gte: new Date(from), lte: release.promotedAt } },
          orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
          take: size,
          select: laneReleaseSelect,
        })
      : [],
    database.release.findMany({
      where: {
        ...lane,
        promotedAt: { gte: new Date(Math.max(from, promoted)), lt: new Date(to) },
      },
      orderBy: [{ promotedAt: 'asc' }, { id: 'asc' }],
      take: size,
      select: laneReleaseSelect,
    }),
    database.release.findMany({
      where: {
        ...lane,
        promotedAt: { lt: new Date(from) },
        // A release reverted before the range has no applies in it.
        OR: [{ revertedAt: null }, { revertedAt: { gte: new Date(from) } }],
      },
      orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
      take: LANE_CANDIDATES,
      select: laneReleaseSelect,
    }),
  ]);

  // Newest first from the start of the range, down to a release that was never
  // reverted and fully rolled out: devices could not fall back past it.
  const live: LaneRelease[] = [];
  const older = [...beforeRange, ...(promoted < from ? [release] : [])].sort((left, right) =>
    byPromotion(right, left),
  );
  for (const item of older) {
    live.push(item);
    if (item.revertedAt === null && item.rolloutPercent === 100) break;
  }

  const all = [...live, ...earlierInRange, ...laterInRange];
  if (!all.some((item) => item.id === release.id)) all.push(release);
  const sorted = [...new Map(all.map((item) => [item.id, item])).values()].sort(byPromotion);
  if (sorted.length <= size) return sorted;
  const index = sorted.findIndex((item) => item.id === release.id);
  const first = Math.min(Math.max(0, index - Math.floor(size / 2)), sorted.length - size);
  return sorted.slice(first, first + size);
}

/** Release, rollout step and revert times within [from, to), oldest first. */
async function releaseMarkers(
  database: PrismaClient,
  organizationId: string,
  release: {
    id: string;
    promotedAt: Date;
    revertedAt: Date | null;
    revertedBy: string | null;
    rolloutPercent: number;
  },
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
      // Reverting a release that never reached 100% is how a rollout is
      // cancelled, unless a newer rollout replaced it.
      label: automatic
        ? 'Auto-reverted'
        : release.revertedBy === ROLLOUT_REPLACED_BY
          ? 'Replaced by a newer rollout'
          : release.rolloutPercent < 100
            ? 'Rollout cancelled'
            : 'Reverted',
    });
  }
  return markers.sort((left, right) => left.at.localeCompare(right.at));
}
