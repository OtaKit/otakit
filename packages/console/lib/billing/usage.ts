import type { PlanKey, UsageWarningSent } from '@prisma/client';

import { db } from '@/lib/db';
import { sendUsageWarningEmail } from '@/lib/email';
import { deleteAllManifestFilesForApp, restoreManifestFilesForApp } from '@/lib/manifest-files';
import { isPolarConfigured } from '@/lib/polar';
import { getCurrentPeriodDownloadCountFromEvents } from '@/lib/tinybird/events';

import { getPlanLimits } from './config';
import { getCreditPool, syncCreditOrders } from './credits';
import { computeUsageState } from './usage-state';

// Months closed in one refresh. A workspace is refreshed at least hourly, so
// more than one only happens after an outage; the cap bounds the catch-up work.
const MAX_PERIODS_CLOSED_PER_REFRESH = 12;

// A refresh lost a race with another refresh or a month close; retry it on a
// fresh read instead of writing stale numbers.
const MAX_REFRESH_ATTEMPTS = 3;

type UsageRunStats = {
  processedOrganizations: number;
  blockedOrganizations: number;
  sent90Warnings: number;
  sent100Warnings: number;
};

const USAGE_ORGANIZATION_SELECT = {
  id: true,
  name: true,
  planKey: true,
  freeDownloadsLimit: true,
  usageBlocked: true,
  usagePeriodStart: true,
  usageCalculatedAt: true,
  downloadsCount: true,
  usageIncludedLimit: true,
  warningSent: true,
  creditsConsumed: true,
  creditsUsed: true,
} as const;

type UsageOrganizationRecord = {
  id: string;
  name: string;
  planKey: PlanKey;
  freeDownloadsLimit: number;
  usageBlocked: boolean;
  usagePeriodStart: Date | null;
  usageCalculatedAt: Date | null;
  downloadsCount: number;
  usageIncludedLimit: number | null;
  warningSent: UsageWarningSent;
  creditsConsumed: number;
  creditsUsed: number;
};

type RefreshUsageOptions = {
  sendWarnings?: boolean;
};

export type OrganizationUsageSnapshot = {
  periodStart: string;
  downloadsCount: number;
  // Downloads included in the plan each month.
  limit: number;
  // Where updates pause: included downloads plus extra download credits.
  effectiveLimit: number;
  // Share of effectiveLimit used.
  percentage: number;
  creditsUsed: number;
  creditsRemaining: number;
  usageBlocked: boolean;
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
 * tracks: recounts its downloads (the last hours after the final hourly check
 * included) and books the credits it used. The compare-and-set on
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
    // The allowance seen during that month, not after a later plan change.
    const includedLimit =
      record.usageIncludedLimit ??
      getPlanLimits(record.planKey, record.freeDownloadsLimit).downloads;

    const downloads = await getCurrentPeriodDownloadCountFromEvents({
      appIds,
      periodStart,
      periodEndExclusive: periodEnd,
    });
    // Credits bought after the month ended belong to the next month.
    const pool = await getCreditPool(record.id, periodEnd);
    const state = computeUsageState({
      downloads,
      includedLimit,
      creditsAvailable: pool - record.creditsConsumed,
      enforceLimits: isPolarConfigured(),
    });

    const { count } = await db.organization.updateMany({
      where: { id: record.id, usagePeriodStart: trackedStart },
      data: {
        usagePeriodStart: periodEnd,
        downloadsCount: 0,
        usageIncludedLimit: null,
        creditsUsed: 0,
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
      usageIncludedLimit: null,
      creditsUsed: 0,
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
        warningSent: true,
        creditsConsumed: true,
        creditsUsed: true,
      },
    }),
    getCreditPool(organizationId),
  ]);

  const planKey = organization?.planKey ?? 'free';
  const limits = getPlanLimits(planKey, organization?.freeDownloadsLimit);
  const inCurrentPeriod = isSameMonth(organization?.usagePeriodStart ?? null, currentPeriodStart);
  // A month that is over but not closed yet will still consume its credits.
  const unclosedCreditsUsed = inCurrentPeriod ? 0 : (organization?.creditsUsed ?? 0);
  const downloadsCount = inCurrentPeriod ? (organization?.downloadsCount ?? 0) : 0;
  const state = computeUsageState({
    downloads: downloadsCount,
    includedLimit: limits.downloads,
    creditsAvailable: pool - (organization?.creditsConsumed ?? 0) - unclosedCreditsUsed,
    enforceLimits: isPolarConfigured(),
  });

  return {
    periodStart: currentPeriodStart.toISOString(),
    downloadsCount,
    limit: limits.downloads,
    effectiveLimit: state.effectiveLimit,
    percentage: state.percentage,
    creditsUsed: state.creditsUsed,
    creditsRemaining: state.creditsRemaining,
    usageBlocked: inCurrentPeriod ? (organization?.usageBlocked ?? false) : false,
    warningSent: inCurrentPeriod ? (organization?.warningSent ?? 'none') : 'none',
  };
}

// ── Warnings ────────────────────────────────────────────────────────

async function sendThresholdWarningEmails(args: {
  organizationId: string;
  organizationName: string;
  planKey: PlanKey;
  threshold: 90 | 100;
  downloadsCount: number;
  limit: number;
  includedLimit: number;
  creditsRemaining: number;
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
        includedLimit: args.includedLimit,
        creditsRemaining: args.creditsRemaining,
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

type RefreshResult = {
  snapshot: OrganizationUsageSnapshot;
  warningThresholdSent: 90 | 100 | null;
};

async function refreshUsageForOrganization(
  organization: UsageOrganizationRecord,
  options: RefreshUsageOptions = {},
  attempt = 1,
): Promise<RefreshResult> {
  const { sendWarnings = true } = options;
  // Read the clock per attempt: a retry after a month close must count the
  // new month, never write the old one back.
  const now = new Date();
  const periodStart = monthStartUTC(now);
  const periodEnd = nextMonthStartUTC(periodStart);
  const appIds = await listOrganizationAppIds(organization.id);

  const record = await closeElapsedUsagePeriods(organization, periodStart, appIds);

  async function retryOnFreshRead(): Promise<RefreshResult> {
    if (attempt >= MAX_REFRESH_ATTEMPTS) {
      throw new Error('Usage refresh kept conflicting with other refreshes');
    }
    return refreshUsageForOrganization(
      await reloadUsageOrganization(organization.id),
      options,
      attempt + 1,
    );
  }

  // Another refresh already moved this workspace into a later month.
  if (record.usagePeriodStart && record.usagePeriodStart > periodStart) {
    return retryOnFreshRead();
  }

  const inCurrentPeriod = isSameMonth(record.usagePeriodStart, periodStart);
  const previousWarning: UsageWarningSent = inCurrentPeriod ? record.warningSent : 'none';

  const downloadsCount = await getCurrentPeriodDownloadCountFromEvents({
    appIds,
    periodStart,
    periodEndExclusive: periodEnd,
  });
  const limits = getPlanLimits(record.planKey, record.freeDownloadsLimit);
  const pool = await getCreditPool(record.id);
  const state = computeUsageState({
    downloads: downloadsCount,
    includedLimit: limits.downloads,
    creditsAvailable: pool - record.creditsConsumed,
    enforceLimits: isPolarConfigured(),
  });

  let warningSent = previousWarning;
  let warningThreshold: 90 | 100 | null = null;
  if (sendWarnings) {
    if (state.percentage < 90 && warningSent !== 'none') {
      warningSent = 'none';
    }
    if (state.percentage >= 100 && previousWarning !== 'at100') {
      warningSent = 'at100';
      warningThreshold = 100;
    } else if (state.percentage >= 90 && previousWarning === 'none') {
      warningSent = 'at90';
      warningThreshold = 90;
    }
  }

  // Compare-and-set on the state this refresh read: a concurrent refresh, a
  // credit grant's refresh or a month close wins, and this one starts over on
  // fresh data instead of saving stale numbers over it.
  const { count } = await db.organization.updateMany({
    where: {
      id: record.id,
      usagePeriodStart: record.usagePeriodStart,
      usageCalculatedAt: record.usageCalculatedAt,
    },
    data: {
      usagePeriodStart: periodStart,
      usageCalculatedAt: now,
      downloadsCount,
      usageIncludedLimit: limits.downloads,
      usageBlocked: state.usageBlocked,
      warningSent,
      creditsUsed: state.creditsUsed,
    },
  });
  if (count === 0) {
    return retryOnFreshRead();
  }

  if (warningThreshold !== null) {
    await sendThresholdWarningEmails({
      organizationId: record.id,
      organizationName: record.name,
      planKey: record.planKey,
      threshold: warningThreshold,
      downloadsCount,
      limit: state.effectiveLimit,
      includedLimit: limits.downloads,
      creditsRemaining: state.creditsRemaining,
      periodStart,
    });
  }

  if (state.usageBlocked !== record.usageBlocked) {
    await applyUsageBlockedChange(record.id, state.usageBlocked, record.usageBlocked);
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
      warningSent,
    },
    warningThresholdSent: warningThreshold,
  };
}

export async function refreshOrganizationUsageSnapshot(
  organizationId: string,
  options: RefreshUsageOptions = {},
): Promise<OrganizationUsageSnapshot> {
  const organization = await reloadUsageOrganization(organizationId);
  return (await refreshUsageForOrganization(organization, options)).snapshot;
}

/**
 * Called after credits were granted or taken back. Never throws: the credits
 * are stored either way and the hourly usage check applies them.
 */
export async function refreshUsageAfterCreditChange(
  organizationId: string,
): Promise<OrganizationUsageSnapshot | null> {
  try {
    return await refreshOrganizationUsageSnapshot(organizationId, { sendWarnings: false });
  } catch (error) {
    console.error('[Credits] usage refresh after a credit change failed', {
      organizationId,
      error,
    });
    return null;
  }
}

export async function runUsageAggregationCron(): Promise<UsageRunStats> {
  const stats: UsageRunStats = {
    processedOrganizations: 0,
    blockedOrganizations: 0,
    sent90Warnings: 0,
    sent100Warnings: 0,
  };

  // Apply pack orders whose webhook was lost, for every customer at once (a
  // first-time buyer may not have its Polar customer id stored yet). The
  // usage refresh below then counts the new credits.
  try {
    await syncCreditOrders();
  } catch (error) {
    console.error('[UsageCron] credit order sync failed', { error });
  }

  // Oldest calculation first, so a run that times out never starves the same
  // workspaces twice in a row.
  const organizations = await db.organization.findMany({
    select: { id: true },
    orderBy: [{ usageCalculatedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
  });

  for (const { id } of organizations) {
    try {
      // Read each workspace right before processing it, so a purchase made
      // while the run is going is not overwritten with stale data.
      const organization = await reloadUsageOrganization(id);
      const { snapshot, warningThresholdSent } = await refreshUsageForOrganization(organization);

      if (warningThresholdSent === 100) {
        stats.sent100Warnings += 1;
      } else if (warningThresholdSent === 90) {
        stats.sent90Warnings += 1;
      }

      if (snapshot.usageBlocked) {
        stats.blockedOrganizations += 1;
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
