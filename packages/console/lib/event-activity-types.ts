/**
 * The activity chart's ranges, splits and response shape, shared by the
 * service and the dashboard (no server imports here).
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Each range keeps about 50 bars or fewer. */
export const EVENT_ACTIVITY_RANGES = {
  '1h': { rangeMs: HOUR_MS, bucketMs: MINUTE_MS, bucketLabel: 'per minute' },
  '24h': { rangeMs: DAY_MS, bucketMs: 30 * MINUTE_MS, bucketLabel: 'per 30 minutes' },
  '7d': { rangeMs: 7 * DAY_MS, bucketMs: 3 * HOUR_MS, bucketLabel: 'per 3 hours' },
  '30d': { rangeMs: 30 * DAY_MS, bucketMs: DAY_MS, bucketLabel: 'per day' },
} as const;

export type EventActivityRange = keyof typeof EVENT_ACTIVITY_RANGES;

/** The dimension the chart splits its bars by. */
export type EventActivitySplit = 'action' | 'bundle' | 'channel' | 'platform' | 'runtime';

export const EVENT_ACTIVITY_SPLITS = [
  'action',
  'bundle',
  'channel',
  'platform',
  'runtime',
] as const satisfies readonly EventActivitySplit[];

export const OTHER_SEGMENT_KEY = '__other';

export function isEventActivityRange(value: unknown): value is EventActivityRange {
  return typeof value === 'string' && Object.hasOwn(EVENT_ACTIVITY_RANGES, value);
}

export function isEventActivitySplit(value: unknown): value is EventActivitySplit {
  return (EVENT_ACTIVITY_SPLITS as readonly unknown[]).includes(value);
}

export type EventActivitySegment = {
  key: string;
  label: string;
  total: number;
  /** Event-list filter value that shows only this segment; null when there is none. */
  filterValue: string | null;
};

export type EventActivityBucket = {
  /** Bucket start; the bucket ends `bucketMs` later. */
  start: string;
  /** Count per segment, in `segments` order. */
  counts: number[];
  total: number;
};

export type EventActivityMarker = {
  at: string;
  type: 'released' | 'rollout' | 'reverted' | 'auto_reverted';
  label: string;
  bundleVersion: string;
  channel: string | null;
  runtimeVersion: string | null;
};

export type EventActivityTotals = {
  downloads: number;
  applied: number;
  downloadErrors: number;
  checkErrors: number;
  rollbacks: number;
  /** Rollbacks / (applies + rollbacks), as auto-revert computes it. */
  rollbackSharePercent: number | null;
};

export type EventActivity = {
  range: EventActivityRange;
  splitBy: EventActivitySplit;
  bucketMs: number;
  /** Start of the first bucket. */
  from: string;
  /** End of the last bucket, which is the current one and still filling. */
  to: string;
  asOf: string;
  unit: 'events';
  analyticsAvailable: boolean;
  totals: EventActivityTotals;
  segments: EventActivitySegment[];
  buckets: EventActivityBucket[];
  markers: EventActivityMarker[];
};
