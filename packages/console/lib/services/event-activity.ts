import type { Prisma, PrismaClient } from '@prisma/client';

import type { DeviceEventAction } from '@/app/components/dashboard-types';
import { AUTO_REVERT_REVERTED_BY } from '@/lib/auto-revert-alerts';
import { db } from '@/lib/db';
import type { EventFilters } from '@/lib/event-filters';
import { isPreviewChannel } from '@/lib/preview-links';
import {
  EVENT_ACTIVITY_RANGES,
  OTHER_SEGMENT_KEY,
  type EventActivity,
  type EventActivityBucket,
  type EventActivityMarker,
  type EventActivityRange,
  type EventActivitySegment,
  type EventActivitySplit,
} from '@/lib/event-activity-types';
import { getAppEventTimeseries } from '@/lib/tinybird/events';

import { ROLLOUT_REPLACED_BY } from './releases';

export {
  EVENT_ACTIVITY_RANGES,
  EVENT_ACTIVITY_SPLITS,
  OTHER_SEGMENT_KEY,
  isEventActivityRange,
  isEventActivitySplit,
} from '@/lib/event-activity-types';
export type {
  EventActivity,
  EventActivityRange,
  EventActivitySplit,
} from '@/lib/event-activity-types';

/**
 * An app's device activity over time, for the chart above the event list: event
 * counts per bucket under the list's filters, split by one dimension, with the
 * releases, rollout steps and reverts of the range as markers.
 */

const MINUTE_MS = 60 * 1000;

/** Bottom to top of each bar: the order a device goes through. */
const ACTION_ORDER: DeviceEventAction[] = [
  'downloaded',
  'applied',
  'download_error',
  'check_error',
  'rollback',
];

const ACTION_LABELS: Record<DeviceEventAction, string> = {
  downloaded: 'Downloaded',
  applied: 'Applied',
  download_error: 'Download error',
  check_error: 'Update check error',
  rollback: 'Rollback',
};

/** Split values beyond this many are folded into "Other". */
const MAX_SEGMENTS = 6;
const PREVIEW_SEGMENT_KEY = '__preview';
const MAX_MARKERS = 100;

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * The buckets of a range on the viewer's clock: the first one holds the range
 * start and the last one is the current, partial bucket. `tzOffsetMinutes` is
 * `Date.getTimezoneOffset()`, minutes behind UTC (UTC+1 is -60). A daylight
 * saving change inside a range keeps the buckets on the offset of `now`.
 */
export function activityWindow(range: EventActivityRange, now: number, tzOffsetMinutes: number) {
  const { rangeMs, bucketMs } = EVENT_ACTIVITY_RANGES[range];
  const shiftMs = modulo(-tzOffsetMinutes * MINUTE_MS, bucketMs);
  const bucketStart = (time: number) =>
    Math.floor((time + shiftMs) / bucketMs) * bucketMs - shiftMs;
  const from = bucketStart(now - rangeMs);
  const last = bucketStart(now);
  return { from, to: last + bucketMs, bucketMs, shiftMs, count: (last - from) / bucketMs + 1 };
}

function describeSegment(
  splitBy: Exclude<EventActivitySplit, 'action'>,
  value: string,
): Omit<EventActivitySegment, 'total'> {
  if (splitBy === 'bundle') {
    return value
      ? { key: value, label: value, filterValue: value }
      : { key: '', label: 'Unknown', filterValue: null };
  }
  if (splitBy === 'channel') {
    if (!value) return { key: '', label: 'base', filterValue: 'base' };
    if (isPreviewChannel(value)) {
      return { key: PREVIEW_SEGMENT_KEY, label: 'Preview', filterValue: null };
    }
    return { key: value, label: value, filterValue: value };
  }
  if (splitBy === 'platform') {
    if (value === 'ios') return { key: value, label: 'iOS', filterValue: value };
    if (value === 'android') return { key: value, label: 'Android', filterValue: value };
    return { key: value, label: value || 'Unknown', filterValue: null };
  }
  return value
    ? { key: value, label: value, filterValue: value }
    : { key: '', label: 'any', filterValue: null };
}

function rollbackSharePercent(applied: number, rollbacks: number): number | null {
  const attempts = applied + rollbacks;
  return attempts === 0 ? null : Math.round((rollbacks / attempts) * 10_000) / 100;
}

export async function getEventActivity(
  input: {
    organizationId: string;
    appId: string;
    range: EventActivityRange;
    splitBy: EventActivitySplit;
    tzOffsetMinutes: number;
    filters: EventFilters;
  },
  dependencies: {
    database?: PrismaClient;
    now?: Date;
    readTimeseries?: typeof getAppEventTimeseries;
  } = {},
): Promise<EventActivity> {
  const database = dependencies.database ?? db;
  const readTimeseries = dependencies.readTimeseries ?? getAppEventTimeseries;
  const now = (dependencies.now ?? new Date()).getTime();
  const { range, splitBy, filters } = input;
  const window = activityWindow(range, now, input.tzOffsetMinutes);

  const [analytics, markers] = await Promise.all([
    readTimeseries({
      appId: input.appId,
      from: new Date(window.from),
      to: new Date(window.to),
      bucketSeconds: window.bucketMs / 1000,
      shiftSeconds: window.shiftMs / 1000,
      splitBy,
      platform: filters.platform,
      action: filters.action,
      bundleVersion: filters.bundleVersion,
      channel: filters.channel ?? undefined,
      channelIsNull: filters.channel === null,
      runtimeVersion: filters.runtimeVersion ?? undefined,
      runtimeVersionIsNull: filters.runtimeVersion === null,
    }),
    activityMarkers(database, input.organizationId, input.appId, filters, window.from, window.to),
  ]);

  const totals = { downloads: 0, applied: 0, downloadErrors: 0, checkErrors: 0, rollbacks: 0 };
  const keyTotals = new Map<string, number>();
  const described = new Map<string, Omit<EventActivitySegment, 'total'>>();
  const points: Array<{ index: number; key: string; count: number }> = [];
  for (const point of analytics.data) {
    const index = Math.floor((point.bucketStart - window.from) / window.bucketMs);
    if (index < 0 || index >= window.count || point.count <= 0) continue;
    if (point.action === 'downloaded') totals.downloads += point.count;
    else if (point.action === 'applied') totals.applied += point.count;
    else if (point.action === 'download_error') totals.downloadErrors += point.count;
    else if (point.action === 'check_error') totals.checkErrors += point.count;
    else totals.rollbacks += point.count;

    let key: string = point.action;
    if (splitBy !== 'action') {
      const segment = describeSegment(splitBy, point.segment);
      key = segment.key;
      if (!described.has(key)) described.set(key, segment);
    }
    keyTotals.set(key, (keyTotals.get(key) ?? 0) + point.count);
    points.push({ index, key, count: point.count });
  }

  let segments: EventActivitySegment[];
  if (splitBy === 'action') {
    segments = ACTION_ORDER.filter((action) => keyTotals.has(action)).map((action) => ({
      key: action,
      label: ACTION_LABELS[action],
      total: keyTotals.get(action) ?? 0,
      filterValue: action,
    }));
  } else {
    // Largest at the bottom of each bar; the smallest ones fold into "Other".
    const ranked = [...described.values()]
      .map((segment) => ({ ...segment, total: keyTotals.get(segment.key) ?? 0 }))
      .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));
    segments = ranked;
    if (ranked.length > MAX_SEGMENTS) {
      const kept = ranked.slice(0, MAX_SEGMENTS - 1);
      const rest = ranked.slice(MAX_SEGMENTS - 1);
      segments = [
        ...kept,
        {
          key: OTHER_SEGMENT_KEY,
          label: `Other (${rest.length})`,
          total: rest.reduce((sum, segment) => sum + segment.total, 0),
          filterValue: null,
        },
      ];
    }
  }

  const slot = new Map(segments.map((segment, index) => [segment.key, index]));
  const otherSlot = slot.get(OTHER_SEGMENT_KEY);
  const buckets: EventActivityBucket[] = Array.from({ length: window.count }, (_, index) => ({
    start: new Date(window.from + index * window.bucketMs).toISOString(),
    counts: new Array<number>(segments.length).fill(0),
    total: 0,
  }));
  for (const point of points) {
    const position = slot.get(point.key) ?? otherSlot;
    if (position === undefined) continue;
    buckets[point.index].counts[position] += point.count;
    buckets[point.index].total += point.count;
  }

  return {
    range,
    splitBy,
    bucketMs: window.bucketMs,
    from: new Date(window.from).toISOString(),
    to: new Date(window.to).toISOString(),
    asOf: new Date(now).toISOString(),
    unit: 'events',
    analyticsAvailable: analytics.available,
    totals: {
      ...totals,
      rollbackSharePercent: rollbackSharePercent(totals.applied, totals.rollbacks),
    },
    segments,
    buckets,
    markers,
  };
}

const markerReleaseSelect = {
  id: true,
  channel: true,
  promotedAt: true,
  revertedAt: true,
  revertedBy: true,
  rolloutPercent: true,
  bundle: { select: { version: true, runtimeVersion: true } },
} satisfies Prisma.ReleaseSelect;

type MarkerRelease = Prisma.ReleaseGetPayload<{ select: typeof markerReleaseSelect }>;

/**
 * Releases, rollout steps and reverts within [from, to) of the releases the
 * filters can see (channel, runtime and bundle; platform and action do not
 * narrow releases), oldest first.
 */
async function activityMarkers(
  database: PrismaClient,
  organizationId: string,
  appId: string,
  filters: EventFilters,
  from: number,
  to: number,
): Promise<EventActivityMarker[]> {
  const bundle: Prisma.BundleWhereInput = {
    ...(filters.bundleVersion ? { version: filters.bundleVersion } : {}),
    ...(filters.runtimeVersion !== undefined ? { runtimeVersion: filters.runtimeVersion } : {}),
  };
  const releaseWhere: Prisma.ReleaseWhereInput = {
    appId,
    ...(filters.channel !== undefined ? { channel: filters.channel } : {}),
    ...(Object.keys(bundle).length > 0 ? { bundle: { is: bundle } } : {}),
  };
  const inRange = { gte: new Date(from), lt: new Date(to) };

  const [releases, steps] = await Promise.all([
    database.release.findMany({
      where: { ...releaseWhere, OR: [{ promotedAt: inRange }, { revertedAt: inRange }] },
      orderBy: [{ promotedAt: 'asc' }, { id: 'asc' }],
      take: MAX_MARKERS,
      select: markerReleaseSelect,
    }),
    database.auditLog.findMany({
      where: { organizationId, action: 'release.rollout_updated', createdAt: inRange },
      orderBy: { createdAt: 'asc' },
      take: MAX_MARKERS,
      select: { createdAt: true, metadata: true, targetId: true },
    }),
  ]);

  const stepTargets = [...new Set(steps.map((step) => step.targetId).filter(Boolean))] as string[];
  const stepReleases = stepTargets.length
    ? await database.release.findMany({
        where: { ...releaseWhere, id: { in: stepTargets } },
        select: markerReleaseSelect,
      })
    : [];
  const stepRelease = new Map(stepReleases.map((release) => [release.id, release]));

  const markers: EventActivityMarker[] = [];
  const add = (
    release: MarkerRelease,
    at: Date,
    type: EventActivityMarker['type'],
    label: string,
  ) =>
    markers.push({
      at: at.toISOString(),
      type,
      label,
      bundleVersion: release.bundle.version,
      channel: release.channel,
      runtimeVersion: release.bundle.runtimeVersion,
    });
  const isInRange = (date: Date) => date.getTime() >= from && date.getTime() < to;

  for (const release of releases) {
    if (isInRange(release.promotedAt)) add(release, release.promotedAt, 'released', 'Released');
    // A rollout replaced by a newer one is reverted at the newer release's own
    // marker, so it gets none of its own.
    if (
      release.revertedAt &&
      isInRange(release.revertedAt) &&
      release.revertedBy !== ROLLOUT_REPLACED_BY
    ) {
      const automatic = release.revertedBy === AUTO_REVERT_REVERTED_BY;
      add(
        release,
        release.revertedAt,
        automatic ? 'auto_reverted' : 'reverted',
        automatic
          ? 'Auto-reverted'
          : release.rolloutPercent < 100
            ? 'Rollout cancelled'
            : 'Reverted',
      );
    }
  }
  for (const step of steps) {
    const release = step.targetId ? stepRelease.get(step.targetId) : undefined;
    const metadata = (step.metadata ?? {}) as { fromPercent?: unknown; toPercent?: unknown };
    if (
      !release ||
      typeof metadata.fromPercent !== 'number' ||
      typeof metadata.toPercent !== 'number'
    ) {
      continue;
    }
    add(
      release,
      step.createdAt,
      'rollout',
      metadata.toPercent === 100
        ? 'Rollout complete'
        : `Rollout ${metadata.fromPercent}% → ${metadata.toPercent}%`,
    );
  }
  return markers.sort((left, right) => left.at.localeCompare(right.at)).slice(0, MAX_MARKERS);
}
