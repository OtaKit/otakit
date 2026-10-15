/**
 * Error tracking rules shared by the cron, services and dashboard. Safe to
 * import from client components.
 */

export const ERROR_ISSUE_STATUSES = ['open', 'resolved', 'ignored'] as const;
export type ErrorIssueStatusValue = (typeof ERROR_ISSUE_STATUSES)[number];

export function isErrorIssueStatus(value: unknown): value is ErrorIssueStatusValue {
  return ERROR_ISSUE_STATUSES.includes(value as ErrorIssueStatusValue);
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Time ranges of the issue list; raw errors are kept 30 days. */
export const ERROR_RANGES = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS } as const;
export type ErrorRange = keyof typeof ERROR_RANGES;
export const DEFAULT_ERROR_RANGE: ErrorRange = '7d';

export function isErrorRange(value: unknown): value is ErrorRange {
  return typeof value === 'string' && Object.hasOwn(ERROR_RANGES, value);
}

/** Fingerprints are 16 lowercase hex characters (see packages/ingest/src/fingerprint.ts). */
export function isFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
}

/**
 * The start of a range, rounded down to the minute so repeated reads share a
 * cache entry. 24 hours are bucketed by hour, longer ranges by day (UTC).
 */
export function errorRangeWindow(
  range: ErrorRange,
  now: Date = new Date(),
): { from: Date; to: Date; hourly: boolean } {
  const minute = Math.floor(now.getTime() / 60_000) * 60_000;
  const hourly = range === '24h';
  const bucket = hourly ? HOUR_MS : DAY_MS;
  return {
    from: new Date(minute - ERROR_RANGES[range]),
    // The end of the current bucket, so the latest bucket is complete in reads.
    to: new Date(Math.floor(minute / bucket) * bucket + bucket),
    hourly,
  };
}

/** "TypeError: Cannot read properties of undefined (reading <str>)". */
export function errorIssueTitle(errorName: string, normalizedMessage: string): string {
  const message = normalizedMessage.trim();
  return message ? `${errorName}: ${message}` : errorName;
}

// ── Alerts ───────────────────────────────────────────────────────────

/** errors.new_issue: once, when an issue first seen in the last 24 hours reaches 5 events. */
export const NEW_ISSUE_MIN_EVENTS = 5;
export const NEW_ISSUE_MAX_AGE_MS = DAY_MS;

export function shouldAlertNewIssue(
  issue: { firstSeenAt: Date; eventCount: number; newIssueAlertedAt: Date | null; status: string },
  now: Date,
): boolean {
  return (
    issue.newIssueAlertedAt === null &&
    issue.status === 'open' &&
    issue.eventCount >= NEW_ISSUE_MIN_EVENTS &&
    now.getTime() - issue.firstSeenAt.getTime() <= NEW_ISSUE_MAX_AGE_MS
  );
}

/**
 * A resolved issue came back when an error was received after it was resolved
 * and also happened after it (device time), so a late retry of an error from
 * before the fix does not reopen it.
 */
export function isRegression(
  issue: { status: string; resolvedAt: Date | null },
  activity: { lastSeenAt: Date; lastOccurredAt: Date },
): boolean {
  return (
    issue.status === 'resolved' &&
    issue.resolvedAt !== null &&
    activity.lastSeenAt > issue.resolvedAt &&
    activity.lastOccurredAt > issue.resolvedAt
  );
}

/** errors.spike: a release's errors per 1,000 applies against the previous release on its lane. */
export const SPIKE_FACTOR = 3;
export const SPIKE_MIN_APPLIES = 50;
export const SPIKE_MIN_EVENTS = 20;
/** Releases are checked for spikes this long after they are published. */
export const SPIKE_WINDOW_MS = 14 * DAY_MS;

export type ReleaseErrorRate = { events: number; applies: number };

export function perThousandApplies(rate: ReleaseErrorRate): number {
  return rate.applies > 0 ? Math.round((rate.events / rate.applies) * 10_000) / 10 : 0;
}

/**
 * True when the release has enough data, and its rate is at least 3× the
 * previous release's. The previous release is a baseline only with enough
 * applies and at least one error: zero errors usually means it did not call
 * initErrorTracking() yet, not that it had none.
 */
export function isErrorSpike(current: ReleaseErrorRate, previous: ReleaseErrorRate): boolean {
  if (current.applies < SPIKE_MIN_APPLIES || current.events < SPIKE_MIN_EVENTS) return false;
  if (previous.applies < SPIKE_MIN_APPLIES || previous.events < 1) return false;
  return current.events * previous.applies >= SPIKE_FACTOR * previous.events * current.applies;
}

// ── Monthly caps ─────────────────────────────────────────────────────

/** The UTC calendar month of `now`: caps reset at its end. */
export function utcMonth(now: Date): { start: Date; endExclusive: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    endExclusive: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}
