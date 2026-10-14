import type { Platform } from '@/app/components/dashboard-types';

import { cachedJson } from '@/lib/redis';

import { isTinybirdConfigured, queryTinybirdPipe, warnTinybirdNotConfigured } from './client';
import type { AnalyticsResult } from './events';
import {
  channelParams,
  chunk,
  count,
  failed,
  isoFromMs,
  text,
  unavailable,
  type Count,
} from './read-helpers';

/**
 * Reads of the custom event pipes (tinybird/endpoints/app_event*.pipe). Raw
 * events are kept 90 days, hourly counts 13 months. Every count is unique
 * event IDs or unique session IDs, so device retries never inflate it.
 */

const pipe = (envName: string, fallback: string) => process.env[envName]?.trim() || fallback;
const NAMES_PIPE = pipe('TINYBIRD_APP_EVENT_NAMES_PIPE', 'app_event_names');
const TIMESERIES_PIPE = pipe('TINYBIRD_APP_EVENT_TIMESERIES_PIPE', 'app_event_timeseries');
const BREAKDOWN_PIPE = pipe('TINYBIRD_APP_EVENT_BREAKDOWN_PIPE', 'app_event_breakdown');
const RELEASES_PIPE = pipe(
  'TINYBIRD_APP_EVENT_RELEASE_COMPARISON_PIPE',
  'app_event_release_comparison',
);
const LIVE_PIPE = pipe('TINYBIRD_APP_EVENTS_LIVE_PIPE', 'app_events_live');
const USAGE_PIPE = pipe('TINYBIRD_APP_EVENT_USAGE_PIPE', 'app_event_usage');

/** Dashboard reads refresh at most this often per query, which bounds Tinybird requests. */
const CACHE_SECONDS = 60;

export type AppEventFilters = {
  appId: string;
  platform?: Platform | null;
  releaseId?: string | null;
  /** undefined = every channel, null = the base channel. */
  channel?: string | null;
};

function filterParams(filters: AppEventFilters) {
  return {
    app_id: filters.appId,
    platform: filters.platform ?? '',
    release_id: filters.releaseId ?? '',
    ...channelParams(filters.channel),
  };
}

async function cached<T>(name: string, params: Record<string, unknown>, ttl = CACHE_SECONDS) {
  return cachedJson(`otakit:events:${name}:${JSON.stringify(params)}`, ttl, () =>
    queryTinybirdPipe<T>(name, params as Record<string, string | number | boolean>),
  );
}

export type AppEventNameCounts = {
  name: string;
  events: number;
  /** App launches with the event. */
  sessions: number;
  /** Events in the period before the range, as long as the range. */
  previousEvents: number;
};

/** Event names with counts in [from, to) and in [previousFrom, from). */
export async function listAppEventNames(
  filters: AppEventFilters & { from: Date; to: Date; previousFrom: Date },
): Promise<AnalyticsResult<AppEventNameCounts[]>> {
  if (!isTinybirdConfigured()) return unavailable('listAppEventNames', []);
  const params = {
    ...filterParams(filters),
    previous_from_ts: filters.previousFrom.toISOString(),
    from_ts: filters.from.toISOString(),
    to_ts: filters.to.toISOString(),
  };
  try {
    const rows = await cached<{
      name?: string | null;
      events?: Count;
      sessions?: Count;
      previous_events?: Count;
    }>(NAMES_PIPE, params);
    return {
      data: rows.flatMap((row) => {
        const name = text(row.name);
        return name
          ? [
              {
                name,
                events: count(row.events),
                sessions: count(row.sessions),
                previousEvents: count(row.previous_events),
              },
            ]
          : [];
      }),
      available: true,
    };
  } catch (error) {
    return failed('app_event_names', { appId: filters.appId }, error, []);
  }
}

export type AppEventBucket = { start: string; events: number; sessions: number };

/**
 * Events and sessions per hour or UTC day in [from, to), keyed by event name:
 * one name with `name`, else every name.
 */
export async function getAppEventTimeseries(
  filters: AppEventFilters & { name?: string; from: Date; to: Date; daily: boolean },
): Promise<AnalyticsResult<Map<string, AppEventBucket[]>>> {
  if (!isTinybirdConfigured()) return unavailable('getAppEventTimeseries', new Map());
  const params = {
    ...filterParams(filters),
    name: filters.name ?? '',
    from_ts: filters.from.toISOString(),
    to_ts: filters.to.toISOString(),
    ...(filters.daily ? { daily: 1 } : {}),
  };
  try {
    const rows = await cached<{
      name?: string | null;
      bucket_start?: Count;
      events?: Count;
      sessions?: Count;
    }>(TIMESERIES_PIPE, params);
    const series = new Map<string, AppEventBucket[]>();
    for (const row of rows) {
      const name = text(row.name);
      const start = count(row.bucket_start);
      if (!name || !start) continue;
      const list = series.get(name) ?? [];
      list.push({
        start: new Date(start * 1000).toISOString(),
        events: count(row.events),
        sessions: count(row.sessions),
      });
      series.set(name, list);
    }
    return { data: series, available: true };
  } catch (error) {
    return failed('app_event_timeseries', { appId: filters.appId }, error, new Map());
  }
}

export type AppEventBreakdown = {
  /** Top 10 values by events; '' = the property was not set. */
  values: Array<{ value: string; events: number; sessions: number }>;
  total: { events: number; sessions: number };
};

/** One event split by a property (raw events, 90 days). */
export async function getAppEventBreakdown(
  filters: AppEventFilters & { name: string; property: string; from: Date; to: Date },
): Promise<AnalyticsResult<AppEventBreakdown>> {
  const empty: AppEventBreakdown = { values: [], total: { events: 0, sessions: 0 } };
  if (!isTinybirdConfigured()) return unavailable('getAppEventBreakdown', empty);
  const params = {
    ...filterParams(filters),
    name: filters.name,
    property: filters.property,
    from_ts: filters.from.toISOString(),
    to_ts: filters.to.toISOString(),
  };
  try {
    const rows = await cached<{
      value?: string | null;
      is_total?: Count;
      events?: Count;
      sessions?: Count;
    }>(BREAKDOWN_PIPE, params);
    const result: AppEventBreakdown = { values: [], total: { events: 0, sessions: 0 } };
    for (const row of rows) {
      const counts = { events: count(row.events), sessions: count(row.sessions) };
      if (count(row.is_total) === 1) result.total = counts;
      else result.values.push({ value: row.value ?? '', ...counts });
    }
    return { data: result, available: true };
  } catch (error) {
    return failed('app_event_breakdown', { appId: filters.appId }, error, empty);
  }
}

export type AppEventReleaseCounts = {
  events: number;
  sessions: number;
  /** Sessions with $session_start: every app launch, when the app sends session events. */
  allSessions: number;
};

/** One event per release (13 months). */
export async function getAppEventReleaseCounts(
  appId: string,
  name: string,
  releaseIds: string[],
): Promise<AnalyticsResult<Map<string, AppEventReleaseCounts>>> {
  if (!isTinybirdConfigured()) return unavailable('getAppEventReleaseCounts', new Map());
  const counts = new Map<string, AppEventReleaseCounts>();
  try {
    for (const batch of chunk(Array.from(new Set(releaseIds.filter(Boolean))), 50)) {
      const rows = await cached<{
        release_id?: string | null;
        events?: Count;
        sessions?: Count;
        all_sessions?: Count;
      }>(RELEASES_PIPE, { app_id: appId, name, release_ids: batch.join(',') });
      for (const row of rows) {
        const releaseId = text(row.release_id);
        if (!releaseId) continue;
        counts.set(releaseId, {
          events: count(row.events),
          sessions: count(row.sessions),
          allSessions: count(row.all_sessions),
        });
      }
    }
    return { data: counts, available: true };
  } catch (error) {
    return failed('app_event_release_comparison', { appId }, error, new Map());
  }
}

export type LiveAppEvent = {
  eventId: string;
  receivedAt: string;
  occurredAt: string;
  name: string;
  /** Developer-chosen values, sent by devices. */
  properties: Record<string, string>;
  platform: Platform;
  releaseId: string | null;
  bundleVersion: string;
  channel: string | null;
  osVersion: string | null;
};

function parseProperties(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string') return {};
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

/** The latest events since `since`, newest first (not cached: it is the live view). */
export async function listLiveAppEvents(input: {
  appId: string;
  name?: string | null;
  since: Date;
  limit: number;
}): Promise<AnalyticsResult<LiveAppEvent[]>> {
  if (!isTinybirdConfigured()) return unavailable('listLiveAppEvents', []);
  try {
    const rows = await queryTinybirdPipe<{
      event_id?: string | null;
      received_at_ms?: Count;
      occurred_at_ms?: Count;
      name?: string | null;
      properties?: string | null;
      platform?: string | null;
      release_id?: string | null;
      bundle_version?: string | null;
      channel?: string | null;
      os_version?: string | null;
    }>(LIVE_PIPE, {
      app_id: input.appId,
      name: input.name ?? '',
      since_ts: input.since.toISOString(),
      limit: Math.min(Math.max(input.limit, 1), 500),
    });
    return {
      data: rows.flatMap((row) => {
        const eventId = text(row.event_id);
        const receivedAt = isoFromMs(row.received_at_ms);
        const name = text(row.name);
        const platform = row.platform;
        if (!eventId || !receivedAt || !name || (platform !== 'ios' && platform !== 'android')) {
          return [];
        }
        return [
          {
            eventId,
            receivedAt,
            occurredAt: isoFromMs(row.occurred_at_ms) ?? receivedAt,
            name,
            properties: parseProperties(row.properties),
            platform,
            releaseId: text(row.release_id),
            bundleVersion: text(row.bundle_version) ?? 'builtin',
            channel: text(row.channel),
            osVersion: text(row.os_version),
          },
        ];
      }),
      available: true,
    };
  } catch (error) {
    return failed('app_events_live', { appId: input.appId }, error, []);
  }
}

/**
 * Custom events per app in [start, endExclusive) (UTC days); without appIds,
 * every app with events. Null when Tinybird is unavailable.
 */
export async function getAppEventUsage(input: {
  start: Date;
  endExclusive: Date;
  appIds?: string[];
}): Promise<Map<string, number> | null> {
  if (!isTinybirdConfigured()) {
    warnTinybirdNotConfigured('getAppEventUsage');
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
        USAGE_PIPE,
        batch ? { ...params, app_ids: batch.join(',') } : params,
      );
      for (const row of rows) {
        const appId = text(row.app_id);
        if (appId) usage.set(appId, count(row.events));
      }
    }
    return usage;
  } catch (error) {
    console.error('[Tinybird] app_event_usage failed', { error });
    return null;
  }
}
