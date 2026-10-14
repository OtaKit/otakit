import type { Platform } from '@/app/components/dashboard-types';

import { cachedJson } from '@/lib/redis';

import { isTinybirdConfigured, queryTinybirdPipe, warnTinybirdNotConfigured } from './client';
import type { AnalyticsResult } from './events';

/**
 * Reads of the error tracking pipes (tinybird/endpoints/error_*.pipe). Raw
 * errors are kept 30 days; the daily rollup 180 days. Every count is unique
 * event IDs, so device retries never inflate it.
 */

const pipe = (envName: string, fallback: string) => process.env[envName]?.trim() || fallback;
const ERROR_ACTIVITY_PIPE = pipe('TINYBIRD_ERROR_ACTIVITY_PIPE', 'error_activity');
const ERROR_GROUPS_PIPE = pipe('TINYBIRD_ERROR_GROUPS_PIPE', 'error_groups');
const ERROR_GROUP_SAMPLES_PIPE = pipe('TINYBIRD_ERROR_GROUP_SAMPLES_PIPE', 'error_group_samples');
const ERROR_GROUP_BREAKDOWN_PIPE = pipe(
  'TINYBIRD_ERROR_GROUP_BREAKDOWN_PIPE',
  'error_group_breakdown',
);
const ERROR_GROUP_BUCKETS_PIPE = pipe('TINYBIRD_ERROR_GROUP_BUCKETS_PIPE', 'error_group_buckets');
const RELEASE_ERROR_COUNTS_PIPE = pipe(
  'TINYBIRD_RELEASE_ERROR_COUNTS_PIPE',
  'release_error_counts',
);
const APP_ERROR_USAGE_PIPE = pipe('TINYBIRD_APP_ERROR_USAGE_PIPE', 'app_error_usage');

/** Dashboard reads refresh at most this often per query, which bounds Tinybird requests. */
const CACHE_SECONDS = 30;
const ID_BATCH_SIZE = 50;
/** The issue list reads at most this many issues per query. */
export const MAX_ERROR_GROUPS = 500;
export const MAX_BUCKET_FINGERPRINTS = 100;

type Count = number | string | null | undefined;

function count(value: Count): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isoFromMs(value: Count): string | null {
  const ms = count(value);
  return ms > 0 ? new Date(ms).toISOString() : null;
}

function parsePlatforms(value: unknown): Platform[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
          try {
            const parsed: unknown = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  return list
    .filter((platform): platform is Platform => platform === 'ios' || platform === 'android')
    .sort();
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function unavailable<T>(context: string, data: T): AnalyticsResult<T> {
  warnTinybirdNotConfigured(context);
  return { data, available: false };
}

function failed<T>(context: string, metadata: Record<string, unknown>, error: unknown, data: T) {
  console.error(`[Tinybird] ${context} failed`, { ...metadata, error });
  return { data, available: false };
}

/** Channel filter: undefined = every channel, null = the base channel (no channel). */
function channelParams(channel: string | null | undefined): Record<string, string | boolean> {
  if (channel === undefined) return {};
  return channel === null ? { channel_is_null: true } : { channel, channel_is_null: false };
}

// ── Cron reads ───────────────────────────────────────────────────────

export type ErrorActivity = {
  appId: string;
  fingerprint: string;
  errorName: string;
  normalizedMessage: string;
  topFrame: string | null;
  firstReleaseId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** The device time of the latest error: a late retry of an old error keeps it old. */
  lastOccurredAt: Date;
  /** Events in the last 180 days. */
  events: number;
};

type ActivityRow = {
  app_id?: string | null;
  fingerprint?: string | null;
  error_name?: string | null;
  normalized_message?: string | null;
  top_frame?: string | null;
  first_release_id?: string | null;
  first_seen_ms?: Count;
  last_seen_ms?: Count;
  last_occurred_ms?: Count;
  events?: Count;
};

/**
 * Issues of every app with errors since `fromDate` (a UTC day), with lifetime
 * totals. Null when Tinybird is unavailable, so the cron skips instead of
 * treating "no data" as "no errors".
 */
export async function getErrorActivity(fromDate: Date): Promise<ErrorActivity[] | null> {
  if (!isTinybirdConfigured()) {
    warnTinybirdNotConfigured('getErrorActivity');
    return null;
  }
  try {
    const rows = await queryTinybirdPipe<ActivityRow>(ERROR_ACTIVITY_PIPE, {
      from_date: fromDate.toISOString().slice(0, 10),
    });
    return rows.flatMap((row) => {
      const appId = text(row.app_id);
      const fingerprint = text(row.fingerprint);
      const firstSeen = count(row.first_seen_ms);
      const lastSeen = count(row.last_seen_ms);
      if (!appId || !fingerprint || !firstSeen || !lastSeen) return [];
      return [
        {
          appId,
          fingerprint,
          errorName: text(row.error_name) ?? 'Error',
          normalizedMessage: row.normalized_message ?? '',
          topFrame: text(row.top_frame),
          firstReleaseId: text(row.first_release_id),
          firstSeenAt: new Date(firstSeen),
          lastSeenAt: new Date(lastSeen),
          lastOccurredAt: new Date(count(row.last_occurred_ms) || lastSeen),
          events: count(row.events),
        },
      ];
    });
  } catch (error) {
    console.error('[Tinybird] error_activity failed', { error });
    return null;
  }
}

export type ReleaseErrorCounts = { events: number; issues: number };

/** Error events and issues per release (180 days). Null when Tinybird is unavailable. */
export async function getReleaseErrorCounts(
  appId: string,
  releaseIds: string[],
): Promise<Map<string, ReleaseErrorCounts> | null> {
  if (!isTinybirdConfigured()) {
    warnTinybirdNotConfigured('getReleaseErrorCounts');
    return null;
  }
  const ids = Array.from(new Set(releaseIds.filter(Boolean)));
  const counts = new Map<string, ReleaseErrorCounts>();
  try {
    for (const batch of chunk(ids, ID_BATCH_SIZE)) {
      const rows = await queryTinybirdPipe<{
        release_id?: string | null;
        events?: Count;
        issues?: Count;
      }>(RELEASE_ERROR_COUNTS_PIPE, { app_id: appId, release_ids: batch.join(',') });
      for (const row of rows) {
        const releaseId = text(row.release_id);
        if (releaseId)
          counts.set(releaseId, { events: count(row.events), issues: count(row.issues) });
      }
    }
    return counts;
  } catch (error) {
    console.error('[Tinybird] release_error_counts failed', { appId, error });
    return null;
  }
}

/**
 * Error events per app in [start, endExclusive) (UTC days); without appIds,
 * every app with errors. Null when Tinybird is unavailable.
 */
export async function getAppErrorUsage(input: {
  start: Date;
  endExclusive: Date;
  appIds?: string[];
}): Promise<Map<string, number> | null> {
  if (!isTinybirdConfigured()) {
    warnTinybirdNotConfigured('getAppErrorUsage');
    return null;
  }
  const params = {
    start_date: input.start.toISOString().slice(0, 10),
    end_date_exclusive: input.endExclusive.toISOString().slice(0, 10),
  };
  const usage = new Map<string, number>();
  try {
    const batches = input.appIds ? chunk(Array.from(new Set(input.appIds)), 100) : [null];
    for (const batch of batches) {
      if (batch?.length === 0) continue;
      const rows = await queryTinybirdPipe<{ app_id?: string | null; events?: Count }>(
        APP_ERROR_USAGE_PIPE,
        batch ? { ...params, app_ids: batch.join(',') } : params,
      );
      for (const row of rows) {
        const appId = text(row.app_id);
        if (appId) usage.set(appId, count(row.events));
      }
    }
    return usage;
  } catch (error) {
    console.error('[Tinybird] app_error_usage failed', { error });
    return null;
  }
}

// ── Dashboard, API and MCP reads ─────────────────────────────────────

export type ErrorGroupFilters = {
  appId: string;
  from: Date;
  to?: Date;
  platform?: Platform | null;
  releaseId?: string | null;
  /** undefined = every channel, null = the base channel. */
  channel?: string | null;
};

export type ErrorGroup = {
  fingerprint: string;
  errorName: string;
  normalizedMessage: string;
  topFrame: string | null;
  /** The latest raw message. Device-reported text. */
  lastMessage: string;
  events: number;
  /** App sessions (process launches) with the error; not devices or users. */
  sessions: number;
  releases: number;
  /** Every event was captured with captureError(). */
  handled: boolean;
  platforms: Platform[];
  firstSeenAt: string;
  lastSeenAt: string;
};

type GroupRow = {
  fingerprint?: string | null;
  error_name?: string | null;
  normalized_message?: string | null;
  top_frame?: string | null;
  last_message?: string | null;
  events?: Count;
  sessions?: Count;
  releases?: Count;
  all_handled?: Count;
  platforms?: unknown;
  first_seen_ms?: Count;
  last_seen_ms?: Count;
};

function groupFromRow(row: GroupRow): ErrorGroup | null {
  const fingerprint = text(row.fingerprint);
  const firstSeenAt = isoFromMs(row.first_seen_ms);
  const lastSeenAt = isoFromMs(row.last_seen_ms);
  if (!fingerprint || !firstSeenAt || !lastSeenAt) return null;
  return {
    fingerprint,
    errorName: text(row.error_name) ?? 'Error',
    normalizedMessage: row.normalized_message ?? '',
    topFrame: text(row.top_frame),
    lastMessage: row.last_message ?? '',
    events: count(row.events),
    sessions: count(row.sessions),
    releases: count(row.releases),
    handled: count(row.all_handled) === 1,
    platforms: parsePlatforms(row.platforms),
    firstSeenAt,
    lastSeenAt,
  };
}

/** Issues with errors in the range, most events (or latest) first. */
export async function listErrorGroups(
  filters: ErrorGroupFilters & {
    sort?: 'events' | 'last_seen';
    fingerprints?: string[];
    limit?: number;
  },
): Promise<AnalyticsResult<ErrorGroup[]>> {
  if (!isTinybirdConfigured()) return unavailable('listErrorGroups', []);
  const params = {
    app_id: filters.appId,
    from_ts: filters.from.toISOString(),
    ...(filters.to ? { to_ts: filters.to.toISOString() } : {}),
    platform: filters.platform ?? '',
    release_id: filters.releaseId ?? '',
    ...channelParams(filters.channel),
    fingerprints: filters.fingerprints?.join(',') ?? '',
    sort: filters.sort ?? 'events',
    limit: Math.min(filters.limit ?? MAX_ERROR_GROUPS, MAX_ERROR_GROUPS),
  };
  if (filters.fingerprints && filters.fingerprints.length === 0) {
    return { data: [], available: true };
  }
  try {
    const rows = await cachedJson(
      `otakit:errors:groups:${JSON.stringify(params)}`,
      CACHE_SECONDS,
      () => queryTinybirdPipe<GroupRow>(ERROR_GROUPS_PIPE, params),
    );
    return {
      data: rows.map(groupFromRow).filter((group): group is ErrorGroup => group !== null),
      available: true,
    };
  } catch (error) {
    return failed('error_groups', { appId: filters.appId }, error, []);
  }
}

export type ErrorSample = {
  eventId: string;
  receivedAt: string;
  occurredAt: string;
  platform: Platform;
  releaseId: string | null;
  bundleVersion: string;
  channel: string | null;
  runtimeVersion: string | null;
  nativeBuild: string;
  osVersion: string | null;
  sdkVersion: string | null;
  errorName: string;
  /** Device-reported text. */
  message: string;
  /** Device-reported text. */
  stack: string | null;
  route: string | null;
  handled: boolean;
  mechanism: 'onerror' | 'unhandledrejection' | 'manual';
  tags: Record<string, string>;
};

type SampleRow = {
  event_id?: string | null;
  received_at_ms?: Count;
  occurred_at_ms?: Count;
  platform?: string | null;
  release_id?: string | null;
  bundle_version?: string | null;
  channel?: string | null;
  runtime_version?: string | null;
  native_build?: string | null;
  os_version?: string | null;
  sdk_version?: string | null;
  error_name?: string | null;
  message?: string | null;
  stack?: string | null;
  route?: string | null;
  handled?: Count;
  mechanism?: string | null;
  tags?: string | null;
};

function parseTags(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

function sampleFromRow(row: SampleRow): ErrorSample | null {
  const eventId = text(row.event_id);
  const receivedAt = isoFromMs(row.received_at_ms);
  const platform = row.platform;
  if (!eventId || !receivedAt || (platform !== 'ios' && platform !== 'android')) return null;
  const mechanism =
    row.mechanism === 'onerror' || row.mechanism === 'unhandledrejection'
      ? row.mechanism
      : 'manual';
  return {
    eventId,
    receivedAt,
    occurredAt: isoFromMs(row.occurred_at_ms) ?? receivedAt,
    platform,
    releaseId: text(row.release_id),
    bundleVersion: text(row.bundle_version) ?? 'builtin',
    channel: text(row.channel),
    runtimeVersion: text(row.runtime_version),
    nativeBuild: text(row.native_build) ?? 'unknown',
    osVersion: text(row.os_version),
    sdkVersion: text(row.sdk_version),
    errorName: text(row.error_name) ?? 'Error',
    message: row.message ?? '',
    stack: text(row.stack),
    route: text(row.route),
    handled: count(row.handled) === 1,
    mechanism,
    tags: parseTags(row.tags),
  };
}

/** The latest events of one issue, newest first. */
export async function getErrorGroupSamples(input: {
  appId: string;
  fingerprint: string;
  from: Date;
  limit?: number;
}): Promise<AnalyticsResult<ErrorSample[]>> {
  if (!isTinybirdConfigured()) return unavailable('getErrorGroupSamples', []);
  const params = {
    app_id: input.appId,
    fingerprint: input.fingerprint,
    from_ts: input.from.toISOString(),
    limit: Math.min(input.limit ?? 20, 50),
  };
  try {
    const rows = await cachedJson(
      `otakit:errors:samples:${JSON.stringify(params)}`,
      CACHE_SECONDS,
      () => queryTinybirdPipe<SampleRow>(ERROR_GROUP_SAMPLES_PIPE, params),
    );
    return {
      data: rows.map(sampleFromRow).filter((sample): sample is ErrorSample => sample !== null),
      available: true,
    };
  } catch (error) {
    return failed('error_group_samples', { appId: input.appId }, error, []);
  }
}

export const BREAKDOWN_DIMENSIONS = [
  'release',
  'platform',
  'os_version',
  'native_build',
  'channel',
  'route',
] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];
export type BreakdownEntry = {
  /** Empty for "none": no release (built-in bundle), base channel, no route or OS version. */
  value: string;
  /** For releases: the bundle version. */
  label: string | null;
  events: number;
};
export type ErrorBreakdown = Record<BreakdownDimension, BreakdownEntry[]>;

export function emptyBreakdown(): ErrorBreakdown {
  return Object.fromEntries(BREAKDOWN_DIMENSIONS.map((dimension) => [dimension, []])) as never;
}

/** Where one issue happens: top 10 values per dimension. */
export async function getErrorGroupBreakdown(input: {
  appId: string;
  fingerprint: string;
  from: Date;
}): Promise<AnalyticsResult<ErrorBreakdown>> {
  if (!isTinybirdConfigured()) return unavailable('getErrorGroupBreakdown', emptyBreakdown());
  const params = {
    app_id: input.appId,
    fingerprint: input.fingerprint,
    from_ts: input.from.toISOString(),
  };
  try {
    const rows = await cachedJson(
      `otakit:errors:breakdown:${JSON.stringify(params)}`,
      CACHE_SECONDS,
      () =>
        queryTinybirdPipe<{
          dimension?: string | null;
          value?: string | null;
          label?: string | null;
          events?: Count;
        }>(ERROR_GROUP_BREAKDOWN_PIPE, params),
    );
    const breakdown = emptyBreakdown();
    for (const row of rows) {
      const dimension = row.dimension as BreakdownDimension;
      if (!BREAKDOWN_DIMENSIONS.includes(dimension)) continue;
      breakdown[dimension].push({
        value: (row.value ?? '').trim(),
        label: text(row.label),
        events: count(row.events),
      });
    }
    return { data: breakdown, available: true };
  } catch (error) {
    return failed('error_group_breakdown', { appId: input.appId }, error, emptyBreakdown());
  }
}

export type ErrorBucket = { start: string; events: number };

/** Events per hour or day for up to 100 issues, keyed by fingerprint. */
export async function getErrorGroupBuckets(
  filters: ErrorGroupFilters & { fingerprints: string[]; to: Date; hourly: boolean },
): Promise<AnalyticsResult<Map<string, ErrorBucket[]>>> {
  if (!isTinybirdConfigured()) return unavailable('getErrorGroupBuckets', new Map());
  const fingerprints = filters.fingerprints.slice(0, MAX_BUCKET_FINGERPRINTS);
  if (fingerprints.length === 0) return { data: new Map(), available: true };
  const params = {
    app_id: filters.appId,
    fingerprints: fingerprints.join(','),
    from_ts: filters.from.toISOString(),
    to_ts: filters.to.toISOString(),
    platform: filters.platform ?? '',
    release_id: filters.releaseId ?? '',
    ...channelParams(filters.channel),
    ...(filters.hourly ? { hourly: 1 } : {}),
  };
  try {
    const rows = await cachedJson(
      `otakit:errors:buckets:${JSON.stringify(params)}`,
      CACHE_SECONDS,
      () =>
        queryTinybirdPipe<{ fingerprint?: string | null; bucket_start?: Count; events?: Count }>(
          ERROR_GROUP_BUCKETS_PIPE,
          params,
        ),
    );
    const buckets = new Map<string, ErrorBucket[]>();
    for (const row of rows) {
      const fingerprint = text(row.fingerprint);
      const start = count(row.bucket_start);
      if (!fingerprint || !start) continue;
      const list = buckets.get(fingerprint) ?? [];
      list.push({ start: new Date(start * 1000).toISOString(), events: count(row.events) });
      buckets.set(fingerprint, list);
    }
    return { data: buckets, available: true };
  } catch (error) {
    return failed('error_group_buckets', { appId: filters.appId }, error, new Map());
  }
}
