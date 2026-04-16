import type {
  DeviceEvent,
  DeviceEventAction,
  EventCountSummary,
  Platform,
} from '@/app/components/dashboard-types';

import { TinybirdConfigError, isTinybirdConfigured, warnTinybirdNotConfigured, queryTinybirdPipe } from './client';

type RecentEventRow = {
  event_id?: string | null;
  app_id?: string | null;
  action?: string | null;
  platform?: string | null;
  bundle_version?: string | null;
  channel?: string | null;
  runtime_version?: string | null;
  release_id?: string | null;
  detail?: string | null;
  received_at?: string | null;
};

type AggregateCountRow = {
  release_id?: string | null;
  bundle_version?: string | null;
  action?: string | null;
  events_count?: number | string | null;
};

type DownloadCountRow = {
  downloads_count?: number | string | null;
};

type RecentAppEventsArgs = {
  appId: string;
  from: Date;
  limit: number;
  platform?: Platform | null;
  action?: DeviceEventAction | null;
  bundleVersion?: string | null;
  channel?: string | null;
  releaseId?: string | null;
};

type CurrentPeriodDownloadCountArgs = {
  appIds: string[];
  periodStart: Date;
  periodEndExclusive: Date;
};

const APP_EVENTS_RECENT_PIPE =
  process.env.TINYBIRD_APP_EVENTS_RECENT_PIPE ?? 'app_events_recent';
const RELEASE_EVENT_COUNTS_PIPE =
  process.env.TINYBIRD_RELEASE_EVENT_COUNTS_PIPE ?? 'release_event_counts';
const BUNDLE_EVENT_COUNTS_PIPE =
  process.env.TINYBIRD_BUNDLE_EVENT_COUNTS_PIPE ?? 'bundle_event_counts';
const ORGANIZATION_DOWNLOAD_COUNTS_PIPE =
  process.env.TINYBIRD_ORGANIZATION_DOWNLOAD_COUNTS_PIPE ?? 'organization_download_counts';

const ID_BATCH_SIZE = 50;
const APP_ID_BATCH_SIZE = 100;
const VALID_ACTIONS: readonly DeviceEventAction[] = [
  'downloaded',
  'applied',
  'download_error',
  'rollback',
];
const VALID_PLATFORMS: readonly Platform[] = ['ios', 'android'];

export function createEmptyEventCounts(): EventCountSummary {
  return { downloads: 0, applied: 0, downloadErrors: 0, rollbacks: 0 };
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isValidPlatform(value: string): value is Platform {
  return (VALID_PLATFORMS as readonly string[]).includes(value);
}

function isValidAction(value: string): value is DeviceEventAction {
  return (VALID_ACTIONS as readonly string[]).includes(value);
}

function parseCount(value: number | string | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatDateOnlyUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeEventRow(row: RecentEventRow): DeviceEvent | null {
  const id = trimToNull(row.event_id);
  const appId = trimToNull(row.app_id);
  const action = trimToNull(row.action);
  const platform = trimToNull(row.platform);
  const createdAt = trimToNull(row.received_at);

  if (!id || !appId || !action || !platform || !createdAt) {
    return null;
  }
  if (!isValidAction(action) || !isValidPlatform(platform)) {
    return null;
  }

  return {
    id,
    appId,
    action,
    platform,
    bundleVersion: trimToNull(row.bundle_version),
    channel: trimToNull(row.channel),
    runtimeVersion: trimToNull(row.runtime_version),
    releaseId: trimToNull(row.release_id),
    detail: trimToNull(row.detail),
    createdAt,
  };
}

function mergeEventCount(
  countsByKey: Map<string, EventCountSummary>,
  key: string,
  action: DeviceEventAction,
  increment: number,
) {
  const current = countsByKey.get(key) ?? createEmptyEventCounts();
  if (action === 'downloaded') {
    current.downloads += increment;
  } else if (action === 'applied') {
    current.applied += increment;
  } else if (action === 'download_error') {
    current.downloadErrors += increment;
  } else if (action === 'rollback') {
    current.rollbacks += increment;
  }
  countsByKey.set(key, current);
}

function logDashboardAnalyticsFailure(context: string, metadata: Record<string, unknown>, error: unknown) {
  console.error(`[Tinybird] ${context} failed`, {
    ...metadata,
    error,
  });
}

export async function listRecentAppEvents(args: RecentAppEventsArgs): Promise<DeviceEvent[]> {
  if (!isTinybirdConfigured()) {
    warnTinybirdNotConfigured('listRecentAppEvents');
    return [];
  }
  try {
    const rows = await queryTinybirdPipe<RecentEventRow>(APP_EVENTS_RECENT_PIPE, {
      app_id: args.appId,
      from_ts: args.from.toISOString(),
      limit: args.limit,
      platform: args.platform ?? '',
      action: args.action ?? '',
      bundle_version: args.bundleVersion ?? '',
      channel: args.channel ?? '',
      release_id: args.releaseId ?? '',
    });

    return rows
      .map(normalizeEventRow)
      .filter((event): event is DeviceEvent => event !== null);
  } catch (error) {
    logDashboardAnalyticsFailure(
      'app_events_recent',
      { appId: args.appId, limit: args.limit },
      error,
    );
    return [];
  }
}

export async function getReleaseEventCounts(
  appId: string,
  releaseIds: string[],
): Promise<Map<string, EventCountSummary>> {
  if (!isTinybirdConfigured()) {
    warnTinybirdNotConfigured('getReleaseEventCounts');
    return new Map();
  }
  const uniqueReleaseIds = Array.from(new Set(releaseIds.map((value) => value.trim()).filter(Boolean)));
  if (uniqueReleaseIds.length === 0) {
    return new Map();
  }

  try {
    const countsByReleaseId = new Map<string, EventCountSummary>();

    for (const batch of chunk(uniqueReleaseIds, ID_BATCH_SIZE)) {
      const rows = await queryTinybirdPipe<AggregateCountRow>(RELEASE_EVENT_COUNTS_PIPE, {
        app_id: appId,
        release_ids: batch.join(','),
      });

      for (const row of rows) {
        const releaseId = trimToNull(row.release_id);
        const action = trimToNull(row.action);
        if (!releaseId || !action || !isValidAction(action)) {
          continue;
        }

        mergeEventCount(countsByReleaseId, releaseId, action, parseCount(row.events_count));
      }
    }

    return countsByReleaseId;
  } catch (error) {
    logDashboardAnalyticsFailure(
      'release_event_counts',
      { appId, releaseIds: uniqueReleaseIds.length },
      error,
    );
    return new Map();
  }
}

export async function getBundleEventCounts(
  appId: string,
  bundleVersions: string[],
): Promise<Map<string, EventCountSummary>> {
  if (!isTinybirdConfigured()) {
    warnTinybirdNotConfigured('getBundleEventCounts');
    return new Map();
  }
  const uniqueBundleVersions = Array.from(
    new Set(bundleVersions.map((value) => value.trim()).filter(Boolean)),
  );
  if (uniqueBundleVersions.length === 0) {
    return new Map();
  }

  try {
    const countsByBundleVersion = new Map<string, EventCountSummary>();

    for (const batch of chunk(uniqueBundleVersions, ID_BATCH_SIZE)) {
      const rows = await queryTinybirdPipe<AggregateCountRow>(BUNDLE_EVENT_COUNTS_PIPE, {
        app_id: appId,
        bundle_versions: batch.join(','),
      });

      for (const row of rows) {
        const bundleVersion = trimToNull(row.bundle_version);
        const action = trimToNull(row.action);
        if (!bundleVersion || !action || !isValidAction(action)) {
          continue;
        }

        mergeEventCount(countsByBundleVersion, bundleVersion, action, parseCount(row.events_count));
      }
    }

    return countsByBundleVersion;
  } catch (error) {
    logDashboardAnalyticsFailure(
      'bundle_event_counts',
      { appId, bundleVersions: uniqueBundleVersions.length },
      error,
    );
    return new Map();
  }
}

export async function getCurrentPeriodDownloadCountFromEvents(
  args: CurrentPeriodDownloadCountArgs,
): Promise<number> {
  if (!isTinybirdConfigured()) {
    warnTinybirdNotConfigured('getCurrentPeriodDownloadCountFromEvents');
    return 0;
  }
  const uniqueAppIds = Array.from(new Set(args.appIds.map((value) => value.trim()).filter(Boolean)));
  if (uniqueAppIds.length === 0) {
    return 0;
  }

  let total = 0;
  for (const batch of chunk(uniqueAppIds, APP_ID_BATCH_SIZE)) {
    const rows = await queryTinybirdPipe<DownloadCountRow>(ORGANIZATION_DOWNLOAD_COUNTS_PIPE, {
      app_ids: batch.join(','),
      start_date: formatDateOnlyUTC(args.periodStart),
      end_date_exclusive: formatDateOnlyUTC(args.periodEndExclusive),
    });

    for (const row of rows) {
      total += parseCount(row.downloads_count);
    }
  }

  return total;
}

export function isTinybirdReadConfigError(error: unknown): boolean {
  return error instanceof TinybirdConfigError;
}
