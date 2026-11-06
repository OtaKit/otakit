import type { DeviceEventAction } from '@/app/components/dashboard-types';
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
import { isPreviewChannel } from '@/lib/preview-links';
import { AUTO_REVERT_REVERTED_BY, ROLLOUT_REPLACED_BY } from '@/lib/release-actors';

/**
 * The activity chart's data from event counts and releases, without any I/O:
 * shared by the service (Tinybird and the database) and the dashboard demo
 * (its in-browser simulation), so both draw exactly the same chart.
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
export const MAX_ACTIVITY_MARKERS = 100;

/** Event count for one bucket, action and value of the split dimension. */
export type ActivityPoint = {
  /** Bucket start, epoch milliseconds. */
  bucketStart: number;
  action: DeviceEventAction;
  /** Value of the split dimension; empty for an action split and for no channel or runtime. */
  segment: string;
  count: number;
};

export type ActivityWindow = ReturnType<typeof activityWindow>;

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

/** Zero-filled buckets, segments (top five plus "Other"), totals and markers. */
export function buildEventActivity(input: {
  range: EventActivityRange;
  splitBy: EventActivitySplit;
  window: ActivityWindow;
  now: number;
  points: ActivityPoint[];
  available: boolean;
  markers: EventActivityMarker[];
}): EventActivity {
  const { range, splitBy, window } = input;
  const totals = { downloads: 0, applied: 0, downloadErrors: 0, checkErrors: 0, rollbacks: 0 };
  const keyTotals = new Map<string, number>();
  const described = new Map<string, Omit<EventActivitySegment, 'total'>>();
  const points: Array<{ index: number; key: string; count: number }> = [];
  for (const point of input.points) {
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
    asOf: new Date(input.now).toISOString(),
    unit: 'events',
    analyticsAvailable: input.available,
    totals: {
      ...totals,
      rollbackSharePercent: rollbackSharePercent(totals.applied, totals.rollbacks),
    },
    segments,
    buckets,
    markers: input.markers,
  };
}

export type MarkerRelease = {
  channel: string | null;
  promotedAt: Date;
  revertedAt: Date | null;
  revertedBy: string | null;
  rolloutPercent: number;
  bundleVersion: string;
  runtimeVersion: string | null;
};

export type MarkerRolloutStep = {
  at: Date;
  /** The stepped release, or undefined when the filters do not see it. */
  release: MarkerRelease | undefined;
  fromPercent: unknown;
  toPercent: unknown;
};

/**
 * Release, rollout step and revert markers within [from, to), oldest first.
 * `releases` and the steps' releases are those the filters can see.
 */
export function buildActivityMarkers(input: {
  releases: MarkerRelease[];
  steps: MarkerRolloutStep[];
  from: number;
  to: number;
}): EventActivityMarker[] {
  const { from, to } = input;
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
      bundleVersion: release.bundleVersion,
      channel: release.channel,
      runtimeVersion: release.runtimeVersion,
    });
  const isInRange = (date: Date) => date.getTime() >= from && date.getTime() < to;

  for (const release of input.releases) {
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
  for (const step of input.steps) {
    if (
      !step.release ||
      !isInRange(step.at) ||
      typeof step.fromPercent !== 'number' ||
      typeof step.toPercent !== 'number'
    ) {
      continue;
    }
    add(
      step.release,
      step.at,
      'rollout',
      step.toPercent === 100
        ? 'Rollout complete'
        : `Rollout ${step.fromPercent}% → ${step.toPercent}%`,
    );
  }
  return markers
    .sort((left, right) => left.at.localeCompare(right.at))
    .slice(0, MAX_ACTIVITY_MARKERS);
}
