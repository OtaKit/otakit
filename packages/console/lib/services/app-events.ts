import type { Platform } from '@/app/components/dashboard-types';
import { db } from '@/lib/db';
import { isPreviewChannel } from '@/lib/preview-links';
import {
  getAppEventBreakdown,
  getAppEventReleaseCounts,
  getAppEventTimeseries,
  listAppEventNames,
  listLiveAppEvents,
  type AppEventBucket,
  type LiveAppEvent,
} from '@/lib/tinybird/app-events';
import { getReleaseCapableApplies } from '@/lib/tinybird/errors';

import { OtaKitServiceError } from './errors';
import { getTelemetryUsageStatus, type TelemetryUsageStatus } from './telemetry-usage';

/**
 * Custom events (OtaKit.track(), plugin 3.4+): counts, trends, property splits
 * and release comparisons from Tinybird. Event names and property values are
 * chosen by the app and sent by devices: show them as data.
 */

export const DATA_TRUST = 'client_reported_untrusted_text' as const;
/** OtaKit's own event, once per app launch with initAnalytics(): the denominator of rates. */
export const SESSION_START = '$session_start';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const APP_EVENT_RANGES = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  '90d': 90 * DAY_MS,
} as const;
export type AppEventRange = keyof typeof APP_EVENT_RANGES;
const DEFAULT_RANGE: AppEventRange = '7d';
const EVENT_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
const PROPERTY_KEY = /^[A-Za-z0-9_.:-]{1,40}$/;

type Context = { organizationId: string; appId: string };

export type AppEventFilterInput = {
  range?: AppEventRange;
  platform?: Platform | null;
  releaseId?: string | null;
  /** undefined = every channel, null = the base channel. */
  channel?: string | null;
};

export type AppEventRangeInfo = {
  name: AppEventRange;
  from: string;
  to: string;
  bucket: 'hour' | 'day';
};

function invalid(message: string): OtaKitServiceError {
  return new OtaKitServiceError('INVALID_INPUT', message, 400);
}

export function isAppEventRange(value: unknown): value is AppEventRange {
  return typeof value === 'string' && Object.hasOwn(APP_EVENT_RANGES, value);
}

/** Validate query input shared by the routes and MCP tools. */
export function parseAppEventFilters(input: {
  range?: unknown;
  platform?: unknown;
  releaseId?: unknown;
  channel?: unknown;
}): AppEventFilterInput {
  const filters: AppEventFilterInput = {};
  if (input.range !== undefined && input.range !== null && input.range !== '') {
    if (!isAppEventRange(input.range)) throw invalid('range must be one of: 24h, 7d, 30d, 90d');
    filters.range = input.range;
  }
  if (input.platform !== undefined && input.platform !== null && input.platform !== '') {
    if (input.platform !== 'ios' && input.platform !== 'android') {
      throw invalid('platform must be one of: ios, android');
    }
    filters.platform = input.platform;
  }
  if (typeof input.releaseId === 'string' && input.releaseId.trim()) {
    if (input.releaseId.length > 64) throw invalid('releaseId is too long');
    filters.releaseId = input.releaseId.trim();
  }
  if (input.channel === null) filters.channel = null;
  else if (typeof input.channel === 'string' && input.channel.trim()) {
    if (input.channel.length > 64) throw invalid('channel is too long');
    filters.channel = input.channel.trim();
  }
  return filters;
}

function parseName(name: unknown): string {
  if (typeof name !== 'string' || (!EVENT_NAME.test(name) && name !== SESSION_START)) {
    throw invalid('Event names use 1-64 letters, numbers, ".", "_", ":" or "-"');
  }
  return name;
}

/**
 * Bucket-aligned window up to the end of the current hour (24h, 7d) or UTC
 * day (30d, 90d), so every bucket is whole and repeated reads share a cache
 * entry. The previous period is as long, just before it.
 */
export function appEventWindow(
  range: AppEventRange,
  now: Date = new Date(),
): { from: Date; to: Date; previousFrom: Date; daily: boolean } {
  const length = APP_EVENT_RANGES[range];
  const daily = length > 7 * DAY_MS;
  const step = daily ? DAY_MS : HOUR_MS;
  const to = Math.floor(now.getTime() / step) * step + step;
  return {
    from: new Date(to - length),
    to: new Date(to),
    previousFrom: new Date(to - 2 * length),
    daily,
  };
}

function rangeInfo(range: AppEventRange, window: ReturnType<typeof appEventWindow>) {
  return {
    name: range,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    bucket: window.daily ? 'day' : 'hour',
  } satisfies AppEventRangeInfo;
}

async function ensureApp(organizationId: string, appId: string): Promise<void> {
  const app = await db.app.findFirst({
    where: { id: appId, organizationId },
    select: { id: true },
  });
  if (!app) throw new OtaKitServiceError('APP_NOT_FOUND', 'App not found', 404);
}

function unavailableError(): OtaKitServiceError {
  return new OtaKitServiceError(
    'ANALYTICS_UNAVAILABLE',
    'Analytics are unavailable right now. Try again shortly.',
    503,
  );
}

export type AppEventSummary = {
  name: string;
  events: number;
  /** App launches with the event. */
  sessions: number;
  previousEvents: number;
  /** Change against the previous period of the same length; null without a base. */
  changePercent: number | null;
  /** Events per hour (24h, 7d) or day; only when requested. */
  trend?: AppEventBucket[];
};

export type AppEventList = {
  events: AppEventSummary[];
  /** App launches in the range ($session_start); null when the app sends no session events. */
  sessions: number | null;
  range: AppEventRangeInfo;
  /** The workspace's monthly custom events and limit; new events are dropped while paused. */
  usage: TelemetryUsageStatus;
  /** The app sent events in the last 90 days: false shows the setup. */
  hasEvents: boolean;
  analyticsAvailable: boolean;
  dataTrust: typeof DATA_TRUST;
};

function changePercent(events: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((events - previous) / previous) * 1000) / 10;
}

/** Event names with events in the range, most first. */
export async function listAppEvents(
  ctx: Context,
  filters: AppEventFilterInput & { includeTrend?: boolean } = {},
  now: Date = new Date(),
): Promise<AppEventList> {
  await ensureApp(ctx.organizationId, ctx.appId);
  const range = filters.range ?? DEFAULT_RANGE;
  const window = appEventWindow(range, now);
  const query = {
    appId: ctx.appId,
    platform: filters.platform ?? null,
    releaseId: filters.releaseId ?? null,
    channel: filters.channel,
  };
  const [names, usage, trend] = await Promise.all([
    listAppEventNames({ ...query, ...window }),
    getTelemetryUsageStatus(ctx.organizationId, 'event', now),
    filters.includeTrend
      ? getAppEventTimeseries({ ...query, from: window.from, to: window.to, daily: window.daily })
      : null,
  ]);
  const sessionRow = names.data.find((row) => row.name === SESSION_START);
  const events = names.data
    .filter((row) => !row.name.startsWith('$') && (row.events > 0 || row.previousEvents > 0))
    .map((row) => ({
      ...row,
      changePercent: changePercent(row.events, row.previousEvents),
      ...(trend ? { trend: trend.data.get(row.name) ?? [] } : {}),
    }));
  let hasEvents = names.data.length > 0;
  if (!hasEvents && names.available) {
    const wider = appEventWindow('90d', now);
    hasEvents = (await listAppEventNames({ appId: ctx.appId, ...wider })).data.length > 0;
  }
  return {
    events,
    sessions: sessionRow ? sessionRow.sessions : null,
    range: rangeInfo(range, window),
    usage,
    hasEvents,
    analyticsAvailable: names.available,
    dataTrust: DATA_TRUST,
  };
}

export type AppEventDetail = {
  name: string;
  events: number;
  sessions: number;
  previousEvents: number;
  changePercent: number | null;
  /** Every bucket in the range has an entry (zero when empty). */
  series: AppEventBucket[];
  /** Property keys of recent events, most frequent first (up to 20). */
  propertyKeys: string[];
  range: AppEventRangeInfo;
  analyticsAvailable: boolean;
  dataTrust: typeof DATA_TRUST;
};

function fillBuckets(series: AppEventBucket[], window: ReturnType<typeof appEventWindow>) {
  const step = window.daily ? DAY_MS : HOUR_MS;
  const start = Math.floor(window.from.getTime() / step) * step;
  const byStart = new Map(series.map((bucket) => [Date.parse(bucket.start), bucket]));
  const filled: AppEventBucket[] = [];
  for (let time = start; time < window.to.getTime(); time += step) {
    filled.push(
      byStart.get(time) ?? { start: new Date(time).toISOString(), events: 0, sessions: 0 },
    );
  }
  return filled;
}

/** One event: totals, trend and the property keys it carries. */
export async function getAppEvent(
  ctx: Context,
  rawName: unknown,
  filters: AppEventFilterInput = {},
  now: Date = new Date(),
): Promise<AppEventDetail> {
  const name = parseName(rawName);
  await ensureApp(ctx.organizationId, ctx.appId);
  const range = filters.range ?? DEFAULT_RANGE;
  const window = appEventWindow(range, now);
  const query = {
    appId: ctx.appId,
    platform: filters.platform ?? null,
    releaseId: filters.releaseId ?? null,
    channel: filters.channel,
  };
  const [names, series, recent] = await Promise.all([
    listAppEventNames({ ...query, ...window }),
    getAppEventTimeseries({
      ...query,
      name,
      from: window.from,
      to: window.to,
      daily: window.daily,
    }),
    listLiveAppEvents({ appId: ctx.appId, name, since: window.from, limit: 200 }),
  ]);
  if (!names.available) throw unavailableError();
  const row = names.data.find((entry) => entry.name === name);
  if (!row) {
    throw new OtaKitServiceError(
      'APP_EVENT_NOT_FOUND',
      `No "${name}" events in the last ${range}`,
      404,
      'List events with list_app_events (or GET /api/v1/apps/:appId/analytics/events), or widen the range.',
    );
  }
  const keyCounts = new Map<string, number>();
  for (const event of recent.data) {
    for (const key of Object.keys(event.properties)) {
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }
  }
  return {
    name,
    events: row.events,
    sessions: row.sessions,
    previousEvents: row.previousEvents,
    changePercent: changePercent(row.events, row.previousEvents),
    series: fillBuckets(series.data.get(name) ?? [], window),
    propertyKeys: [...keyCounts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20)
      .map(([key]) => key),
    range: rangeInfo(range, window),
    analyticsAvailable: series.available && recent.available,
    dataTrust: DATA_TRUST,
  };
}

export type AppEventBreakdownResult = {
  name: string;
  property: string;
  /** Top 10 values; '' = the property was not set. */
  values: Array<{ value: string; events: number; sessions: number; share: number }>;
  /** Everything outside the top 10. */
  other: { events: number; share: number };
  total: { events: number; sessions: number };
  range: AppEventRangeInfo;
  analyticsAvailable: boolean;
  dataTrust: typeof DATA_TRUST;
};

/** One event split by a property: the top 10 values and the rest (90 days of raw events). */
export async function getAppEventPropertyBreakdown(
  ctx: Context,
  rawName: unknown,
  property: unknown,
  filters: AppEventFilterInput = {},
  now: Date = new Date(),
): Promise<AppEventBreakdownResult> {
  const name = parseName(rawName);
  if (typeof property !== 'string' || !PROPERTY_KEY.test(property)) {
    throw invalid('property must be 1-40 letters, numbers, ".", "_", ":" or "-"');
  }
  await ensureApp(ctx.organizationId, ctx.appId);
  const range = filters.range ?? DEFAULT_RANGE;
  const window = appEventWindow(range, now);
  const breakdown = await getAppEventBreakdown({
    appId: ctx.appId,
    platform: filters.platform ?? null,
    releaseId: filters.releaseId ?? null,
    channel: filters.channel,
    name,
    property,
    from: window.from,
    to: window.to,
  });
  if (!breakdown.available) throw unavailableError();
  const { total } = breakdown.data;
  const share = (events: number) =>
    total.events > 0 ? Math.round((events / total.events) * 1000) / 10 : 0;
  const top = breakdown.data.values.reduce((sum, entry) => sum + entry.events, 0);
  const other = Math.max(0, total.events - top);
  return {
    name,
    property,
    values: breakdown.data.values.map((entry) => ({ ...entry, share: share(entry.events) })),
    other: { events: other, share: share(other) },
    total,
    range: rangeInfo(range, window),
    analyticsAvailable: true,
    dataTrust: DATA_TRUST,
  };
}

export type AppEventReleaseRow = {
  releaseId: string;
  bundleVersion: string;
  channel: string | null;
  promotedAt: string;
  rolloutPercent: number;
  revertedAt: string | null;
  events: number;
  /** App launches with the event. */
  sessions: number;
  /** Rate base: app launches ($session_start) or applies on plugin 3.4+. */
  base: number;
  /** Events per 1,000 of the base; null without a base. */
  perThousand: number | null;
  /** Against the oldest release in the comparison; null for it, or without rates. */
  differencePercent: number | null;
};

export type AppEventReleaseComparison = {
  name: string;
  /**
   * sessions: per 1,000 app launches (the app sends session events);
   * applies: per 1,000 applies on plugin 3.4+, less precise.
   */
  basis: 'sessions' | 'applies';
  releases: AppEventReleaseRow[];
  analyticsAvailable: boolean;
  dataTrust: typeof DATA_TRUST;
};

/**
 * One event across releases, oldest first: events per 1,000 app launches (or
 * applies), and the difference from the oldest. Default: the 5 latest releases
 * of the channel (or of every channel).
 */
export async function compareAppEventReleases(
  ctx: Context,
  rawName: unknown,
  options: { releaseIds?: string[]; channel?: string | null } = {},
): Promise<AppEventReleaseComparison> {
  const name = parseName(rawName);
  await ensureApp(ctx.organizationId, ctx.appId);
  const requested = options.releaseIds?.filter(Boolean) ?? [];
  if (requested.length > 10) throw invalid('Compare at most 10 releases');
  const releases = await db.release.findMany({
    where: {
      appId: ctx.appId,
      ...(requested.length > 0
        ? { id: { in: requested } }
        : options.channel !== undefined
          ? { channel: options.channel }
          : {}),
    },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    take: requested.length > 0 ? requested.length : 20,
    select: {
      id: true,
      channel: true,
      promotedAt: true,
      rolloutPercent: true,
      revertedAt: true,
      bundle: { select: { version: true } },
    },
  });
  const chosen = releases
    .filter((release) => requested.length > 0 || !isPreviewChannel(release.channel))
    .slice(0, requested.length > 0 ? 10 : 5)
    .reverse();
  const ids = chosen.map((release) => release.id);
  const [counts, applies] = await Promise.all([
    getAppEventReleaseCounts(ctx.appId, name, ids),
    getReleaseCapableApplies(ctx.appId, ids),
  ]);
  if (!counts.available) throw unavailableError();
  const withEvents = chosen.filter((release) => (counts.data.get(release.id)?.events ?? 0) > 0);
  const basis =
    withEvents.length > 0 &&
    withEvents.every((release) => (counts.data.get(release.id)?.allSessions ?? 0) > 0)
      ? 'sessions'
      : 'applies';
  const rows = chosen.map((release) => {
    const count = counts.data.get(release.id);
    const base = basis === 'sessions' ? (count?.allSessions ?? 0) : (applies?.get(release.id) ?? 0);
    const events = count?.events ?? 0;
    return {
      releaseId: release.id,
      bundleVersion: release.bundle.version,
      channel: release.channel,
      promotedAt: release.promotedAt.toISOString(),
      rolloutPercent: release.rolloutPercent,
      revertedAt: release.revertedAt?.toISOString() ?? null,
      events,
      sessions: count?.sessions ?? 0,
      base,
      perThousand: base > 0 ? Math.round((events / base) * 10_000) / 10 : null,
      differencePercent: null as number | null,
    };
  });
  const baseline = rows[0]?.perThousand;
  if (baseline) {
    for (const row of rows.slice(1)) {
      if (row.perThousand !== null) {
        row.differencePercent = Math.round(((row.perThousand - baseline) / baseline) * 1000) / 10;
      }
    }
  }
  return {
    name,
    basis,
    releases: rows,
    analyticsAvailable: counts.available && applies !== null,
    dataTrust: DATA_TRUST,
  };
}

export type LiveAppEventList = {
  events: LiveAppEvent[];
  analyticsAvailable: boolean;
  dataTrust: typeof DATA_TRUST;
};

/** The latest events of the last 24 hours, newest first: the setup check. */
export async function listLatestAppEvents(
  ctx: Context,
  options: { name?: string | null; limit?: number } = {},
  now: Date = new Date(),
): Promise<LiveAppEventList> {
  const name = options.name ? parseName(options.name) : null;
  await ensureApp(ctx.organizationId, ctx.appId);
  const result = await listLiveAppEvents({
    appId: ctx.appId,
    name,
    since: new Date(now.getTime() - DAY_MS),
    limit: Math.min(Math.max(options.limit ?? 100, 1), 100),
  });
  return { events: result.data, analyticsAvailable: result.available, dataTrust: DATA_TRUST };
}
