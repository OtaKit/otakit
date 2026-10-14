import type { ErrorIssue } from '@prisma/client';

import { recordAuditLog, type AuditActor } from '@/lib/audit-log';
import { getPlanLimits } from '@/lib/billing/config';
import { db } from '@/lib/db';
import {
  errorIssueTitle,
  isErrorSpike,
  isRegression,
  perThousandApplies,
  shouldAlertNewIssue,
  utcMonth,
  NEW_ISSUE_MAX_AGE_MS,
  NEW_ISSUE_MIN_EVENTS,
  SPIKE_WINDOW_MS,
} from '@/lib/error-tracking';
import { emitNotification } from '@/lib/notifications/emit';
import type { NotificationErrorIssue } from '@/lib/notifications/events';
import { isPolarConfigured } from '@/lib/polar';
import { findReleaseSummary } from '@/lib/services/releases';
import { pauseTelemetry, replaceTelemetryApps, resumeTelemetry } from '@/lib/telemetry-gate';
import {
  getAppErrorUsage,
  getErrorActivity,
  getReleaseErrorCounts,
  type ErrorActivity,
} from '@/lib/tinybird/errors';
import { getReleaseEventCountsWithStatus } from '@/lib/tinybird/events';

/**
 * The errors cron (every 5 minutes): keeps the ingest app allowlist and
 * ErrorIssue rows in step with Tinybird, reopens resolved issues that come
 * back, sends the error alerts and enforces the monthly caps. Every step is
 * idempotent and guarded by conditional writes, so overlapping runs are safe.
 */

export const ERROR_TRACKING_ACTOR: AuditActor = {
  actorType: 'system',
  actorLabel: 'error-tracking',
};

export type ErrorsCronStats = {
  /** Apps in the ingest allowlist; null without Redis. */
  allowlistApps: number | null;
  activeIssues: number;
  created: number;
  updated: number;
  regressions: number;
  newIssueAlerts: number;
  spikeAlerts: number;
  paused: number;
  resumed: number;
  /** Notifications queued for delivery. */
  queued: number;
  /** Steps that could not run (Tinybird or Redis unavailable, or a failure). */
  skipped: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const APP_CHUNK = 200;

export function issuePayload(issue: ErrorIssue): NotificationErrorIssue {
  return {
    id: issue.id,
    fingerprint: issue.fingerprint,
    title: errorIssueTitle(issue.errorName, issue.normalizedMessage),
    topFrame: issue.topFrame,
    status: issue.status,
    events: issue.eventCount,
    firstSeenAt: issue.firstSeenAt.toISOString(),
    lastSeenAt: issue.lastSeenAt.toISOString(),
    firstReleaseId: issue.firstReleaseId,
  };
}

async function step(name: string, stats: ErrorsCronStats, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    console.error(
      JSON.stringify({
        errorsCronStepFailed: name,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    stats.skipped.push(name);
  }
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function runErrorsCron(now: Date = new Date()): Promise<ErrorsCronStats> {
  const stats: ErrorsCronStats = {
    allowlistApps: null,
    activeIssues: 0,
    created: 0,
    updated: 0,
    regressions: 0,
    newIssueAlerts: 0,
    spikeAlerts: 0,
    paused: 0,
    resumed: 0,
    queued: 0,
    skipped: [],
  };
  const apps = await db.app.findMany({ select: { id: true, organizationId: true } });
  const organizationOf = new Map(apps.map((app) => [app.id, app.organizationId]));

  await step('allowlist', stats, async () => {
    const replaced = await replaceTelemetryApps(apps.map((app) => app.id));
    stats.allowlistApps = replaced ? apps.length : null;
  });

  let changedApps = new Set<string>();
  await step('issues', stats, async () => {
    const since = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS,
    );
    const activity = await getErrorActivity(since);
    if (activity === null) {
      stats.skipped.push('issues');
      return;
    }
    // Deleted apps keep their errors in Tinybird until they expire.
    const live = activity.filter((row) => organizationOf.has(row.appId));
    stats.activeIssues = live.length;
    changedApps = await syncIssues(live, now, organizationOf, stats);
  });

  await step('new_issue_alerts', stats, () => alertNewIssues(now, organizationOf, stats));
  await step('spikes', stats, () => alertSpikes([...changedApps], now, organizationOf, stats));
  await step('caps', stats, () => enforceCaps(now, organizationOf, stats));
  return stats;
}

/** Upsert issues from the activity rows; returns the apps whose issues got new events. */
async function syncIssues(
  activity: ErrorActivity[],
  now: Date,
  organizationOf: Map<string, string>,
  stats: ErrorsCronStats,
): Promise<Set<string>> {
  const changedApps = new Set<string>();
  const byApp = new Map<string, ErrorActivity[]>();
  for (const row of activity) {
    const list = byApp.get(row.appId) ?? [];
    list.push(row);
    byApp.set(row.appId, list);
  }

  for (const [appId, rows] of byApp) {
    const existing = new Map<string, ErrorIssue>();
    for (const fingerprints of chunk(
      rows.map((row) => row.fingerprint),
      APP_CHUNK,
    )) {
      const found = await db.errorIssue.findMany({
        where: { appId, fingerprint: { in: fingerprints } },
      });
      for (const issue of found) existing.set(issue.fingerprint, issue);
    }

    const creates = rows.filter((row) => !existing.has(row.fingerprint));
    if (creates.length > 0) {
      const created = await db.errorIssue.createMany({
        data: creates.map((row) => ({
          appId,
          fingerprint: row.fingerprint,
          errorName: row.errorName.slice(0, 200),
          normalizedMessage: row.normalizedMessage.slice(0, 1000),
          topFrame: row.topFrame?.slice(0, 500) ?? null,
          firstReleaseId: row.firstReleaseId,
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
          eventCount: row.events,
        })),
        skipDuplicates: true,
      });
      stats.created += created.count;
      changedApps.add(appId);
    }

    const updates: Array<{ issue: ErrorIssue; row: ErrorActivity }> = [];
    for (const row of rows) {
      const issue = existing.get(row.fingerprint);
      if (!issue) continue;
      if (isRegression(issue, row)) {
        await reopen(issue, row, now, organizationOf.get(appId)!, stats);
        changedApps.add(appId);
        continue;
      }
      if (
        row.lastSeenAt.getTime() !== issue.lastSeenAt.getTime() ||
        row.events !== issue.eventCount ||
        row.firstSeenAt < issue.firstSeenAt ||
        (issue.firstReleaseId === null && row.firstReleaseId !== null)
      ) {
        updates.push({ issue, row });
        if (row.lastSeenAt > issue.lastSeenAt) changedApps.add(appId);
      }
    }
    for (const batch of chunk(updates, APP_CHUNK)) {
      // One statement per batch. Timestamps travel as ISO text and are cast to
      // timestamp(3), the UTC wall clock Prisma stores, independent of the session time zone.
      stats.updated += await db.$executeRaw`
        UPDATE "ErrorIssue" AS issue
        SET "lastSeenAt" = GREATEST(issue."lastSeenAt", data."lastSeenAt"::timestamp(3)),
            "firstSeenAt" = LEAST(issue."firstSeenAt", data."firstSeenAt"::timestamp(3)),
            "eventCount" = data."eventCount",
            "firstReleaseId" = COALESCE(issue."firstReleaseId", data."firstReleaseId"),
            "updatedAt" = ${now.toISOString()}::timestamp(3)
        FROM unnest(
          ${batch.map(({ issue }) => issue.id)}::text[],
          ${batch.map(({ row }) => row.lastSeenAt.toISOString())}::text[],
          ${batch.map(({ row }) => row.firstSeenAt.toISOString())}::text[],
          ${batch.map(({ row }) => row.events)}::int[],
          ${batch.map(({ row }) => row.firstReleaseId)}::text[]
        ) AS data("id", "lastSeenAt", "firstSeenAt", "eventCount", "firstReleaseId")
        WHERE issue."id" = data."id"`;
    }
  }
  return changedApps;
}

/** A resolved issue happened again: reopen it and send errors.regression once. */
async function reopen(
  issue: ErrorIssue,
  row: ErrorActivity,
  now: Date,
  organizationId: string,
  stats: ErrorsCronStats,
) {
  const reopened = await db.$transaction(async (tx) => {
    const claimed = await tx.errorIssue.updateMany({
      where: { id: issue.id, status: 'resolved', resolvedAt: issue.resolvedAt },
      data: {
        status: 'open',
        resolvedAt: null,
        regressions: { increment: 1 },
        statusChangedAt: now,
        statusChangedBy: ERROR_TRACKING_ACTOR.actorLabel,
        lastSeenAt: row.lastSeenAt > issue.lastSeenAt ? row.lastSeenAt : issue.lastSeenAt,
        eventCount: row.events,
      },
    });
    if (claimed.count === 0) return null;
    const updated = await tx.errorIssue.findUniqueOrThrow({ where: { id: issue.id } });
    stats.queued += await emitNotification(tx, {
      type: 'errors.regression',
      key: `errors.regression:${issue.id}:${updated.regressions}`,
      organizationId,
      appId: issue.appId,
      actor: null,
      dashboardParams: { issue: issue.fingerprint },
      data: {
        issue: issuePayload(updated),
        previouslyResolvedAt: issue.resolvedAt!.toISOString(),
      },
    });
    return updated;
  });
  if (!reopened) return;
  stats.regressions += 1;
  await recordAuditLog({
    organizationId,
    actor: ERROR_TRACKING_ACTOR,
    action: 'error_issue.regressed',
    targetType: 'error_issue',
    targetId: issue.id,
    metadata: {
      appId: issue.appId,
      fingerprint: issue.fingerprint,
      title: errorIssueTitle(issue.errorName, issue.normalizedMessage),
      resolvedAt: issue.resolvedAt!.toISOString(),
    },
  });
}

/** errors.new_issue: once per issue, when one first seen in the last 24 hours reaches 5 events. */
async function alertNewIssues(
  now: Date,
  organizationOf: Map<string, string>,
  stats: ErrorsCronStats,
) {
  const candidates = await db.errorIssue.findMany({
    where: {
      status: 'open',
      newIssueAlertedAt: null,
      eventCount: { gte: NEW_ISSUE_MIN_EVENTS },
      firstSeenAt: { gte: new Date(now.getTime() - NEW_ISSUE_MAX_AGE_MS) },
    },
    take: 500,
  });
  for (const issue of candidates) {
    const organizationId = organizationOf.get(issue.appId);
    if (!organizationId || !shouldAlertNewIssue(issue, now)) continue;
    await db.$transaction(async (tx) => {
      const claimed = await tx.errorIssue.updateMany({
        where: { id: issue.id, newIssueAlertedAt: null },
        data: { newIssueAlertedAt: now },
      });
      if (claimed.count === 0) return;
      stats.newIssueAlerts += 1;
      stats.queued += await emitNotification(tx, {
        type: 'errors.new_issue',
        key: `errors.new_issue:${issue.id}`,
        organizationId,
        appId: issue.appId,
        actor: null,
        dashboardParams: { issue: issue.fingerprint },
        data: { issue: issuePayload(issue) },
      });
    });
  }
}

/**
 * errors.spike: the current release of a lane, published in the last 14 days,
 * against the release before it on the same lane (channel and runtime).
 */
async function alertSpikes(
  appIds: string[],
  now: Date,
  organizationOf: Map<string, string>,
  stats: ErrorsCronStats,
) {
  for (const appId of appIds) {
    const releases = await db.release.findMany({
      where: { appId, revertedAt: null },
      orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
      take: 200,
      select: {
        id: true,
        channel: true,
        promotedAt: true,
        errorSpikeAlertedAt: true,
        bundle: { select: { runtimeVersion: true } },
      },
    });
    const lanes = new Map<string, typeof releases>();
    for (const release of releases) {
      const lane = JSON.stringify([release.channel, release.bundle.runtimeVersion]);
      const list = lanes.get(lane) ?? [];
      if (list.length < 2) list.push(release);
      lanes.set(lane, list);
    }
    const pairs = Array.from(lanes.values()).filter(
      ([current, previous]) =>
        previous &&
        current.errorSpikeAlertedAt === null &&
        now.getTime() - current.promotedAt.getTime() <= SPIKE_WINDOW_MS,
    );
    if (pairs.length === 0) continue;

    const ids = pairs.flatMap(([current, previous]) => [current.id, previous.id]);
    const [errors, applies] = await Promise.all([
      getReleaseErrorCounts(appId, ids),
      getReleaseEventCountsWithStatus(appId, ids),
    ]);
    if (!errors || !applies.available) {
      stats.skipped.push(`spikes:${appId}`);
      continue;
    }
    const rate = (id: string) => ({
      events: errors.get(id)?.events ?? 0,
      applies: applies.data.get(id)?.applied ?? 0,
      issues: errors.get(id)?.issues ?? 0,
    });
    for (const [current, previous] of pairs) {
      const currentRate = rate(current.id);
      const previousRate = rate(previous.id);
      if (!isErrorSpike(currentRate, previousRate)) continue;
      const [release, previousRelease] = await Promise.all([
        findReleaseSummary(current.id),
        findReleaseSummary(previous.id),
      ]);
      if (!release || !previousRelease) continue;
      await db.$transaction(async (tx) => {
        const claimed = await tx.release.updateMany({
          where: { id: current.id, errorSpikeAlertedAt: null },
          data: { errorSpikeAlertedAt: now },
        });
        if (claimed.count === 0) return;
        stats.spikeAlerts += 1;
        stats.queued += await emitNotification(tx, {
          type: 'errors.spike',
          key: `errors.spike:${current.id}`,
          organizationId: organizationOf.get(appId)!,
          appId,
          actor: null,
          data: {
            release,
            previousRelease,
            errors: {
              events: currentRate.events,
              applies: currentRate.applies,
              perThousandApplies: perThousandApplies(currentRate),
              previousEvents: previousRate.events,
              previousApplies: previousRate.applies,
              previousPerThousandApplies: perThousandApplies(previousRate),
              issues: currentRate.issues,
            },
          },
        });
      });
    }
  }
}

/**
 * Monthly caps: a workspace at its plan's error limit is paused at ingest until
 * the next UTC month, and owners hear about it once. Upgrading (or a new month)
 * resumes it on the next run. Servers without billing have no caps.
 */
async function enforceCaps(now: Date, organizationOf: Map<string, string>, stats: ErrorsCronStats) {
  const appsOf = new Map<string, string[]>();
  for (const [appId, organizationId] of organizationOf) {
    const list = appsOf.get(organizationId) ?? [];
    list.push(appId);
    appsOf.set(organizationId, list);
  }
  const resume = async (organizationId: string) => {
    await resumeTelemetry('error', appsOf.get(organizationId) ?? []);
    await db.organization.update({
      where: { id: organizationId },
      data: { errorsPausedUntil: null },
    });
    stats.resumed += 1;
  };

  if (!isPolarConfigured()) {
    const paused = await db.organization.findMany({
      where: { errorsPausedUntil: { not: null } },
      select: { id: true },
    });
    for (const organization of paused) await resume(organization.id);
    return;
  }

  const month = utcMonth(now);
  const usage = await getAppErrorUsage(month);
  if (!usage) {
    stats.skipped.push('caps');
    return;
  }
  const organizationUsage = new Map<string, number>();
  for (const [appId, events] of usage) {
    const organizationId = organizationOf.get(appId);
    if (organizationId) {
      organizationUsage.set(organizationId, (organizationUsage.get(organizationId) ?? 0) + events);
    }
  }
  const organizations = await db.organization.findMany({
    where: {
      OR: [{ id: { in: [...organizationUsage.keys()] } }, { errorsPausedUntil: { not: null } }],
    },
    select: { id: true, planKey: true, errorsPausedUntil: true },
  });
  for (const organization of organizations) {
    const events = organizationUsage.get(organization.id) ?? 0;
    const limit = getPlanLimits(organization.planKey).errorEvents;
    if (events < limit) {
      if (organization.errorsPausedUntil) await resume(organization.id);
      continue;
    }
    // Every run, so apps created since are paused too; the keys expire with the month.
    await pauseTelemetry('error', appsOf.get(organization.id) ?? [], month.endExclusive);
    if (organization.errorsPausedUntil?.getTime() === month.endExclusive.getTime()) continue;
    await db.$transaction(async (tx) => {
      const claimed = await tx.organization.updateMany({
        where: {
          id: organization.id,
          OR: [{ errorsPausedUntil: null }, { errorsPausedUntil: { not: month.endExclusive } }],
        },
        data: { errorsPausedUntil: month.endExclusive },
      });
      if (claimed.count === 0) return;
      stats.paused += 1;
      stats.queued += await emitNotification(tx, {
        type: 'errors.paused',
        key: `errors.paused:${organization.id}:${month.start.toISOString().slice(0, 7)}`,
        organizationId: organization.id,
        appId: null,
        actor: null,
        data: {
          errorUsage: { events, limit, pausedUntil: month.endExclusive.toISOString() },
        },
      });
    });
  }
}
