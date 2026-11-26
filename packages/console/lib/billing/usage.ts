import type { PlanKey, UsageWarningSent } from '@prisma/client';

import { db } from '@/lib/db';
import { sendUsageWarningEmail } from '@/lib/email';
import { deleteAllManifestFilesForApp, restoreManifestFilesForApp } from '@/lib/manifest-files';
import { getPolar, isPolarConfigured } from '@/lib/polar';
import { getCurrentPeriodDownloadCountFromEvents } from '@/lib/tinybird/events';

import { getExternalCustomerId, getPlanLimits } from './config';
import { getCreditPool, syncCreditOrders } from './credits';
import { computeUsageState } from './usage-state';

const POLAR_USAGE_EVENT_NAME = process.env.POLAR_USAGE_EVENT_NAME ?? 'otakit.download.usage.v1';

// Months closed in one refresh. A workspace is refreshed at least hourly, so
// more than one only happens after an outage; the cap bounds the catch-up work.
const MAX_PERIODS_CLOSED_PER_REFRESH = 12;

type UsageRunStats = {
  processedOrganizations: number;
  blockedOrganizations: number;
  sent90Warnings: number;
  sent100Warnings: number;
  polarSyncedOrganizations: number;
};

const USAGE_ORGANIZATION_SELECT = {
  id: true,
  name: true,
  planKey: true,
  freeDownloadsLimit: true,
  usageBlocked: true,
  overageEnabled: true,
  usagePeriodStart: true,
  usageCalculatedAt: true,
  downloadsCount: true,
  warningSent: true,
  creditsConsumed: true,
  creditsUsed: true,
  polarReportedCount: true,
  polarCustomerId: true,
} as const;

type UsageOrganizationRecord = {
  id: string;
  name: string;
  planKey: PlanKey;
  freeDownloadsLimit: number;
  usageBlocked: boolean;
  overageEnabled: boolean;
  usagePeriodStart: Date | null;
  usageCalculatedAt: Date | null;
  downloadsCount: number;
  warningSent: UsageWarningSent;
  creditsConsumed: number;
  creditsUsed: number;
  polarReportedCount: number;
  polarCustomerId: string | null;
};

type RefreshUsageOptions = {
  sendWarnings?: boolean;
  syncPolar?: boolean;
};

export type OrganizationUsageSnapshot = {
  periodStart: string;
  downloadsCount: number;
  // Downloads included in the plan each month.
  limit: number;
  // Included downloads plus the extra download credits available this month.
  effectiveLimit: number;
  // Share of effectiveLimit used.
  percentage: number;
  creditsUsed: number;
  creditsRemaining: number;
  usageBlocked: boolean;
  overageEnabled: boolean;
  warningSent: UsageWarningSent;
};

function monthStartUTC(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function nextMonthStartUTC(monthStart: Date): Date {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
}

function isSameMonth(a: Date | null, b: Date): boolean {
  if (!a) return false;
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

function overageActive(planKey: PlanKey, freeDownloadsLimit: number, overageEnabled: boolean) {
  return getPlanLimits(planKey, freeDownloadsLimit).overage && overageEnabled;
}

function polarMeterId(): string | null {
  if (!isPolarConfigured()) return null;
  return process.env.POLAR_METER_DOWNLOADS_ID?.trim() || null;
}

async function listOrganizationAppIds(organizationId: string): Promise<string[]> {
  const apps = await db.app.findMany({
    where: { organizationId },
    select: { id: true },
  });
  return apps.map((app) => app.id);
}

async function syncManifestFilesForOrganization(
  organizationId: string,
  usageBlocked: boolean,
): Promise<void> {
  const appIds = await listOrganizationAppIds(organizationId);

  if (usageBlocked) {
    await Promise.all(appIds.map((appId) => deleteAllManifestFilesForApp(appId)));
    return;
  }

  await Promise.all(appIds.map((appId) => restoreManifestFilesForApp(appId)));
}

/**
 * Deletes or restores the update manifests after usageBlocked was saved (a
 * restore reads the saved flag). If storage fails, the previous flag is put
 * back, so the next usage check sees the change again and retries; otherwise
 * a workspace that just bought credits could stay without manifests.
 */
async function applyUsageBlockedChange(
  organizationId: string,
  usageBlocked: boolean,
  previousUsageBlocked: boolean,
): Promise<void> {
  try {
    await syncManifestFilesForOrganization(organizationId, usageBlocked);
  } catch (error) {
    await db.organization
      .update({ where: { id: organizationId }, data: { usageBlocked: previousUsageBlocked } })
      .catch((revertError: unknown) => {
        console.error('[Usage] could not restore the previous block state', {
          organizationId,
          error: revertError,
        });
      });
    throw error;
  }
}

// ── Polar meter (Pro additional usage) ──────────────────────────────
// Usage is reported only while additional usage is on. Reporting it with the
// toggle off let Polar bill downloads served between two usage checks, and
// a Polar billing cycle that spans two calendar months could add up to more
// than the monthly allowance even though neither month went over.

async function getPolarReportedTotal(args: {
  organizationId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<number | null> {
  const meterId = polarMeterId();
  if (!meterId) return null;
  try {
    const quantities = await getPolar().meters.quantities({
      id: meterId,
      startTimestamp: args.periodStart,
      endTimestamp: args.periodEnd,
      interval: 'month',
      externalCustomerId: getExternalCustomerId(args.organizationId),
    });
    return Math.floor(quantities.total ?? 0);
  } catch (error) {
    console.error('[UsagePolarSync] quantities failed', {
      organizationId: args.organizationId,
      error,
    });
    return null;
  }
}

/** Sends target − alreadyReported to the meter. Returns the meter total after. */
async function reportUsageToPolar(args: {
  organizationId: string;
  periodStart: Date;
  target: number;
  alreadyReported: number;
  // Back-dates the final report of a closed month into that month.
  timestamp?: Date;
}): Promise<number | null> {
  const delta = args.target - args.alreadyReported;
  if (delta <= 0) return args.alreadyReported;

  try {
    await getPolar().events.ingest({
      events: [
        {
          name: POLAR_USAGE_EVENT_NAME,
          externalCustomerId: getExternalCustomerId(args.organizationId),
          externalId: `usage:${args.organizationId}:${args.periodStart.toISOString()}:${args.target}`,
          ...(args.timestamp ? { timestamp: args.timestamp } : {}),
          metadata: {
            quantity: delta,
            periodStart: args.periodStart.toISOString(),
          },
        },
      ],
    });
    return args.target;
  } catch (error) {
    console.error('[UsagePolarSync] ingest failed', {
      organizationId: args.organizationId,
      delta,
      error,
    });
    return null;
  }
}

// ── Month close ─────────────────────────────────────────────────────

async function reloadUsageOrganization(organizationId: string): Promise<UsageOrganizationRecord> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: USAGE_ORGANIZATION_SELECT,
  });
  if (!organization) throw new Error('Organization not found');
  return organization;
}

/**
 * Finalizes every month before `currentPeriodStart` that this workspace still
 * tracks: recounts its downloads, books the credits it used, and sends Pro
 * additional usage of the month's last hours to Polar. The compare-and-set on
 * usagePeriodStart makes concurrent refreshes close each month exactly once.
 */
async function closeElapsedUsagePeriods(
  organization: UsageOrganizationRecord,
  currentPeriodStart: Date,
  appIds: string[],
): Promise<UsageOrganizationRecord> {
  let record = organization;

  for (let step = 0; step < MAX_PERIODS_CLOSED_PER_REFRESH; step += 1) {
    const trackedStart = record.usagePeriodStart;
    if (!trackedStart || trackedStart >= currentPeriodStart) return record;

    const periodStart = monthStartUTC(trackedStart);
    const periodEnd = nextMonthStartUTC(periodStart);
    const limits = getPlanLimits(record.planKey, record.freeDownloadsLimit);
    const overageEnabled = limits.overage && record.overageEnabled;

    const downloads = await getCurrentPeriodDownloadCountFromEvents({
      appIds,
      periodStart,
      periodEndExclusive: periodEnd,
    });
    const polarTotal = overageEnabled
      ? await getPolarReportedTotal({ organizationId: record.id, periodStart, periodEnd })
      : null;
    // Credits bought after the month ended belong to the next month.
    const pool = await getCreditPool(record.id, periodEnd);
    const state = computeUsageState({
      downloads,
      includedLimit: limits.downloads,
      creditsAvailable: pool - record.creditsConsumed,
      polarReportedCount: polarTotal ?? record.polarReportedCount,
      overageEnabled,
      enforceLimits: isPolarConfigured(),
    });

    if (polarTotal !== null) {
      await reportUsageToPolar({
        organizationId: record.id,
        periodStart,
        target: state.polarTarget,
        alreadyReported: polarTotal,
        timestamp: new Date(periodEnd.getTime() - 1000),
      });
    }

    const { count } = await db.organization.updateMany({
      where: { id: record.id, usagePeriodStart: trackedStart },
      data: {
        usagePeriodStart: periodEnd,
        downloadsCount: 0,
        creditsUsed: 0,
        polarReportedCount: 0,
        warningSent: 'none',
        creditsConsumed: { increment: state.creditsUsed },
      },
    });

    if (count === 0) {
      // Another refresh closed this month first.
      record = await reloadUsageOrganization(record.id);
      continue;
    }

    if (state.creditsUsed > 0) {
      console.info('[Credits] month closed', {
        organizationId: record.id,
        periodStart: periodStart.toISOString(),
        downloads,
        creditsUsed: state.creditsUsed,
      });
    }

    record = {
      ...record,
      usagePeriodStart: periodEnd,
      downloadsCount: 0,
      creditsUsed: 0,
      polarReportedCount: 0,
      warningSent: 'none',
      creditsConsumed: record.creditsConsumed + state.creditsUsed,
    };
  }

  return record;
}

// ── Snapshot (stored values, no recount) ────────────────────────────

export async function getOrganizationUsageSnapshot(
  organizationId: string,
): Promise<OrganizationUsageSnapshot> {
  const currentPeriodStart = monthStartUTC();
  const [organization, pool] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        planKey: true,
        freeDownloadsLimit: true,
        usagePeriodStart: true,
        downloadsCount: true,
        usageBlocked: true,
        overageEnabled: true,
        warningSent: true,
        creditsConsumed: true,
        creditsUsed: true,
        polarReportedCount: true,
      },
    }),
    getCreditPool(organizationId),
  ]);

  const planKey = organization?.planKey ?? 'free';
  const limits = getPlanLimits(planKey, organization?.freeDownloadsLimit);
  const overageEnabled = limits.overage && (organization?.overageEnabled ?? false);
  const inCurrentPeriod = isSameMonth(organization?.usagePeriodStart ?? null, currentPeriodStart);
  // A month that is over but not closed yet will still consume its credits.
  const unclosedCreditsUsed = inCurrentPeriod ? 0 : (organization?.creditsUsed ?? 0);
  const state = computeUsageState({
    downloads: inCurrentPeriod ? (organization?.downloadsCount ?? 0) : 0,
    includedLimit: limits.downloads,
    creditsAvailable: pool - (organization?.creditsConsumed ?? 0) - unclosedCreditsUsed,
    polarReportedCount: inCurrentPeriod ? (organization?.polarReportedCount ?? 0) : 0,
    overageEnabled,
    enforceLimits: isPolarConfigured(),
  });

  return {
    periodStart: currentPeriodStart.toISOString(),
    downloadsCount: inCurrentPeriod ? (organization?.downloadsCount ?? 0) : 0,
    limit: limits.downloads,
    effectiveLimit: state.effectiveLimit,
    percentage: state.percentage,
    creditsUsed: state.creditsUsed,
    creditsRemaining: state.creditsRemaining,
    usageBlocked: inCurrentPeriod ? (organization?.usageBlocked ?? false) : false,
    overageEnabled,
    warningSent: inCurrentPeriod ? (organization?.warningSent ?? 'none') : 'none',
  };
}

// ── Additional usage toggle ─────────────────────────────────────────

export async function updateOrganizationOverageEnabled(
  organizationId: string,
  overageEnabled: boolean,
): Promise<OrganizationUsageSnapshot> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { planKey: true, freeDownloadsLimit: true },
  });
  if (!organization) {
    throw new Error('Organization not found');
  }

  const limits = getPlanLimits(organization.planKey, organization.freeDownloadsLimit);
  if (overageEnabled && !limits.overage) {
    throw new Error('Additional usage is only available on the Pro plan');
  }

  await db.organization.update({
    where: { id: organizationId },
    data: { overageEnabled: limits.overage && overageEnabled },
  });

  // Recount so the block state (and the manifests) follow the toggle at once.
  try {
    return await refreshOrganizationUsageSnapshot(organizationId, {
      sendWarnings: false,
      syncPolar: false,
    });
  } catch (error) {
    // The toggle is saved; the next usage check applies the block state.
    console.error('[Usage] refresh after the additional usage toggle failed', {
      organizationId,
      error,
    });
    return getOrganizationUsageSnapshot(organizationId);
  }
}

// ── Warnings ────────────────────────────────────────────────────────

async function sendThresholdWarningEmails(args: {
  organizationId: string;
  organizationName: string;
  planKey: PlanKey;
  threshold: 90 | 100;
  downloadsCount: number;
  limit: number;
  creditsRemaining: number;
  overageEnabled: boolean;
  periodStart: Date;
}): Promise<void> {
  const members = await db.organizationMember.findMany({
    where: {
      organizationId: args.organizationId,
      role: { in: ['owner', 'admin'] },
    },
    select: {
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  const uniqueEmails = Array.from(new Set(members.map((m) => m.user.email)));
  await Promise.all(
    uniqueEmails.map((email) =>
      sendUsageWarningEmail({
        to: email,
        organizationName: args.organizationName,
        planKey: args.planKey,
        threshold: args.threshold,
        downloadsCount: args.downloadsCount,
        limit: args.limit,
        creditsRemaining: args.creditsRemaining,
        overageEnabled: args.overageEnabled,
        periodStart: args.periodStart,
      }).catch((error) => {
        console.error('[UsageWarningEmail] send failed', {
          organizationId: args.organizationId,
          email,
          threshold: args.threshold,
          error,
        });
      }),
    ),
  );
}

// ── Refresh ─────────────────────────────────────────────────────────

async function refreshUsageForOrganization(
  organization: UsageOrganizationRecord,
  now = new Date(),
  options: RefreshUsageOptions = {},
): Promise<{
  snapshot: OrganizationUsageSnapshot;
  warningThresholdSent: 90 | 100 | null;
  polarSynced: boolean;
}> {
  const { sendWarnings = true, syncPolar = true } = options;
  const periodStart = monthStartUTC(now);
  const periodEnd = nextMonthStartUTC(periodStart);
  const appIds = await listOrganizationAppIds(organization.id);

  const record = await closeElapsedUsagePeriods(organization, periodStart, appIds);
  const inCurrentPeriod = isSameMonth(record.usagePeriodStart, periodStart);
  const previousWarning: UsageWarningSent = inCurrentPeriod ? record.warningSent : 'none';
  const previousPolarReported = inCurrentPeriod ? record.polarReportedCount : 0;

  const downloadsCount = await getCurrentPeriodDownloadCountFromEvents({
    appIds,
    periodStart,
    periodEndExclusive: periodEnd,
  });
  const limits = getPlanLimits(record.planKey, record.freeDownloadsLimit);
  const overageEnabled = overageActive(
    record.planKey,
    record.freeDownloadsLimit,
    record.overageEnabled,
  );

  const polarTotal =
    syncPolar && overageEnabled
      ? await getPolarReportedTotal({ organizationId: record.id, periodStart, periodEnd })
      : null;
  const polarReportedCount = polarTotal ?? previousPolarReported;

  const pool = await getCreditPool(record.id);
  const state = computeUsageState({
    downloads: downloadsCount,
    includedLimit: limits.downloads,
    creditsAvailable: pool - record.creditsConsumed,
    polarReportedCount,
    overageEnabled,
    enforceLimits: isPolarConfigured(),
  });

  let warningSent = previousWarning;
  let warningThresholdSent: 90 | 100 | null = null;

  if (sendWarnings) {
    if (state.percentage < 90 && warningSent !== 'none') {
      warningSent = 'none';
    }

    const warning = {
      organizationId: record.id,
      organizationName: record.name,
      planKey: record.planKey,
      downloadsCount,
      limit: state.effectiveLimit,
      creditsRemaining: state.creditsRemaining,
      overageEnabled,
      periodStart,
    };
    if (state.percentage >= 100 && previousWarning !== 'at100') {
      await sendThresholdWarningEmails({ ...warning, threshold: 100 });
      warningSent = 'at100';
      warningThresholdSent = 100;
    } else if (state.percentage >= 90 && previousWarning === 'none') {
      await sendThresholdWarningEmails({ ...warning, threshold: 90 });
      warningSent = 'at90';
      warningThresholdSent = 90;
    }
  }

  const usageBlockedChanged = state.usageBlocked !== record.usageBlocked;

  await db.organization.update({
    where: { id: record.id },
    data: {
      usagePeriodStart: periodStart,
      usageCalculatedAt: now,
      downloadsCount,
      usageBlocked: state.usageBlocked,
      overageEnabled,
      warningSent,
      creditsUsed: state.creditsUsed,
      polarReportedCount,
    },
  });
  if (usageBlockedChanged) {
    await applyUsageBlockedChange(record.id, state.usageBlocked, record.usageBlocked);
  }

  let polarSynced = false;
  if (polarTotal !== null) {
    const reported = await reportUsageToPolar({
      organizationId: record.id,
      periodStart,
      target: state.polarTarget,
      alreadyReported: polarTotal,
    });
    if (reported !== null && reported !== polarTotal) {
      polarSynced = true;
      await db.organization.updateMany({
        where: { id: record.id, usagePeriodStart: periodStart },
        data: { polarReportedCount: reported },
      });
    }
  }

  return {
    snapshot: {
      periodStart: periodStart.toISOString(),
      downloadsCount,
      limit: limits.downloads,
      effectiveLimit: state.effectiveLimit,
      percentage: state.percentage,
      creditsUsed: state.creditsUsed,
      creditsRemaining: state.creditsRemaining,
      usageBlocked: state.usageBlocked,
      overageEnabled,
      warningSent,
    },
    warningThresholdSent,
    polarSynced,
  };
}

export async function refreshOrganizationUsageSnapshot(
  organizationId: string,
  options: RefreshUsageOptions = {},
): Promise<OrganizationUsageSnapshot> {
  const organization = await reloadUsageOrganization(organizationId);
  return (await refreshUsageForOrganization(organization, new Date(), options)).snapshot;
}

/**
 * Called after credits were granted or taken back. Never throws: the credits
 * are stored either way and the hourly usage check applies them.
 */
export async function refreshUsageAfterCreditChange(
  organizationId: string,
): Promise<OrganizationUsageSnapshot | null> {
  try {
    return await refreshOrganizationUsageSnapshot(organizationId, {
      sendWarnings: false,
      syncPolar: false,
    });
  } catch (error) {
    console.error('[Credits] usage refresh after a credit change failed', {
      organizationId,
      error,
    });
    return null;
  }
}

export async function runUsageAggregationCron(): Promise<UsageRunStats> {
  const now = new Date();

  const organizations = await db.organization.findMany({ select: { id: true } });

  const stats: UsageRunStats = {
    processedOrganizations: 0,
    blockedOrganizations: 0,
    sent90Warnings: 0,
    sent100Warnings: 0,
    polarSyncedOrganizations: 0,
  };

  for (const { id } of organizations) {
    try {
      // Read each workspace right before processing it, so a purchase or
      // toggle made while the run is going is not overwritten with stale data.
      const organization = await reloadUsageOrganization(id);

      // Catch credit orders whose webhook was lost before counting usage.
      if (organization.polarCustomerId) {
        try {
          await syncCreditOrders(organization.id);
        } catch (error) {
          console.error('[UsageCron] credit order sync failed', {
            organizationId: organization.id,
            error,
          });
        }
      }

      const { snapshot, warningThresholdSent, polarSynced } = await refreshUsageForOrganization(
        organization,
        now,
      );

      if (warningThresholdSent === 100) {
        stats.sent100Warnings += 1;
      } else if (warningThresholdSent === 90) {
        stats.sent90Warnings += 1;
      }

      if (snapshot.usageBlocked) {
        stats.blockedOrganizations += 1;
      }

      if (polarSynced) {
        stats.polarSyncedOrganizations += 1;
      }

      stats.processedOrganizations += 1;
    } catch (error) {
      console.error('[UsageCron] organization processing failed', {
        organizationId: id,
        error,
      });
    }
  }

  return stats;
}
