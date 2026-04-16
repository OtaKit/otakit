import type { PlanKey, UsageWarningSent } from '@prisma/client';

import { db } from '@/lib/db';
import { sendUsageWarningEmail } from '@/lib/email';
import {
  deleteAllManifestFilesForApp,
  restoreManifestFilesForApp,
} from '@/lib/manifest-files';
import { getPolar, isPolarConfigured, warnPolarNotConfigured } from '@/lib/polar';
import { getCurrentPeriodDownloadCountFromEvents } from '@/lib/tinybird/events';

import { getExternalCustomerId, getPlanLimits } from './config';

const POLAR_USAGE_EVENT_NAME = process.env.POLAR_USAGE_EVENT_NAME ?? 'otakit.download.usage.v1';

type UsageRunStats = {
  processedOrganizations: number;
  blockedOrganizations: number;
  sent90Warnings: number;
  sent100Warnings: number;
  polarSyncedOrganizations: number;
};

type UsageOrganizationRecord = {
  id: string;
  name: string;
  planKey: PlanKey;
  usageBlocked: boolean;
  overageEnabled: boolean;
  usagePeriodStart: Date | null;
  usageCalculatedAt: Date | null;
  downloadsCount: number;
  warningSent: UsageWarningSent;
};

type RefreshUsageOptions = {
  sendWarnings?: boolean;
  syncPolar?: boolean;
};

export type OrganizationUsageSnapshot = {
  periodStart: string;
  downloadsCount: number;
  limit: number;
  percentage: number;
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

async function syncManifestFilesForOrganization(
  organizationId: string,
  usageBlocked: boolean,
): Promise<void> {
  const apps = await db.app.findMany({
    where: { organizationId },
    select: { id: true },
  });

  if (usageBlocked) {
    await Promise.all(apps.map((app) => deleteAllManifestFilesForApp(app.id)));
    return;
  }

  await Promise.all(apps.map((app) => restoreManifestFilesForApp(app.id)));
}

export async function getOrganizationUsageSnapshot(
  organizationId: string,
): Promise<OrganizationUsageSnapshot> {
  const currentPeriodStart = monthStartUTC();
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      planKey: true,
      usagePeriodStart: true,
      downloadsCount: true,
      usageBlocked: true,
      overageEnabled: true,
      warningSent: true,
    },
  });

  const planKey = organization?.planKey ?? 'starter';
  const limit = getPlanLimits(planKey).downloads;
  const inCurrentPeriod = isSameMonth(organization?.usagePeriodStart ?? null, currentPeriodStart);
  const downloadsCount = inCurrentPeriod ? (organization?.downloadsCount ?? 0) : 0;
  const usageBlocked = inCurrentPeriod ? (organization?.usageBlocked ?? false) : false;
  const warningSent: UsageWarningSent = inCurrentPeriod
    ? (organization?.warningSent ?? 'none')
    : 'none';
  const percentage = limit > 0 ? Math.round((downloadsCount / limit) * 100) : 0;

  return {
    periodStart: currentPeriodStart.toISOString(),
    downloadsCount,
    limit,
    percentage,
    usageBlocked,
    overageEnabled: organization?.overageEnabled ?? false,
    warningSent,
  };
}

export async function updateOrganizationOverageEnabled(
  organizationId: string,
  overageEnabled: boolean,
): Promise<OrganizationUsageSnapshot> {
  const currentPeriodStart = monthStartUTC();

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      planKey: true,
      usageBlocked: true,
      usagePeriodStart: true,
      usageCalculatedAt: true,
      downloadsCount: true,
      warningSent: true,
    },
  });

  if (!organization) {
    throw new Error('Organization not found');
  }

  const inCurrentPeriod = isSameMonth(organization.usagePeriodStart, currentPeriodStart);
  const downloadsCount = inCurrentPeriod ? organization.downloadsCount : 0;
  const warningSent: UsageWarningSent = inCurrentPeriod ? organization.warningSent : 'none';
  const usageCalculatedAt = inCurrentPeriod
    ? (organization.usageCalculatedAt ?? (downloadsCount > 0 ? new Date() : currentPeriodStart))
    : currentPeriodStart;

  const limit = getPlanLimits(organization.planKey).downloads;
  const usageBlocked = isPolarConfigured() ? !overageEnabled && downloadsCount >= limit : false;
  const usageBlockedChanged = usageBlocked !== organization.usageBlocked;

  await db.organization.update({
    where: { id: organizationId },
    data: {
      overageEnabled,
      usageBlocked,
      usagePeriodStart: currentPeriodStart,
      usageCalculatedAt,
      downloadsCount,
      warningSent,
    },
  });
  if (usageBlockedChanged) {
    await syncManifestFilesForOrganization(organizationId, usageBlocked);
  }

  return {
    periodStart: currentPeriodStart.toISOString(),
    downloadsCount,
    limit,
    percentage: limit > 0 ? Math.round((downloadsCount / limit) * 100) : 0,
    usageBlocked,
    overageEnabled,
    warningSent,
  };
}

async function sendThresholdWarningEmails(args: {
  organizationId: string;
  organizationName: string;
  threshold: 90 | 100;
  downloadsCount: number;
  limit: number;
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
        threshold: args.threshold,
        downloadsCount: args.downloadsCount,
        limit: args.limit,
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

async function syncOrganizationUsageToPolar(args: {
  organizationId: string;
  periodStart: Date;
  periodEnd: Date;
  downloadsCount: number;
}): Promise<boolean> {
  if (!isPolarConfigured()) return false;
  const meterId = process.env.POLAR_METER_DOWNLOADS_ID;
  if (!meterId) return false;

  const externalCustomerId = getExternalCustomerId(args.organizationId);
  let polarTotal = 0;

  try {
    const quantities = await getPolar().meters.quantities({
      id: meterId,
      startTimestamp: args.periodStart,
      endTimestamp: args.periodEnd,
      interval: 'month',
      externalCustomerId,
    });
    polarTotal = Math.floor(quantities.total ?? 0);
  } catch (error) {
    console.error('[UsagePolarSync] quantities failed', {
      organizationId: args.organizationId,
      error,
    });
    return false;
  }

  const delta = args.downloadsCount - polarTotal;
  if (delta <= 0) return false;

  try {
    await getPolar().events.ingest({
      events: [
        {
          name: POLAR_USAGE_EVENT_NAME,
          externalCustomerId,
          externalId: `usage:${args.organizationId}:${args.periodStart.toISOString()}:${args.downloadsCount}`,
          metadata: {
            quantity: delta,
            periodStart: args.periodStart.toISOString(),
          },
        },
      ],
    });
    return true;
  } catch (error) {
    console.error('[UsagePolarSync] ingest failed', {
      organizationId: args.organizationId,
      delta,
      error,
    });
    return false;
  }
}

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
  const inCurrentPeriod = isSameMonth(organization.usagePeriodStart, periodStart);
  const previousWarning: UsageWarningSent = inCurrentPeriod ? organization.warningSent : 'none';

  const apps = await db.app.findMany({
    where: { organizationId: organization.id },
    select: { id: true },
  });
  const appIds = apps.map((app) => app.id);

  const downloadsCount = await getCurrentPeriodDownloadCountFromEvents({
    appIds,
    periodStart,
    periodEndExclusive: periodEnd,
  });
  const limit = getPlanLimits(organization.planKey).downloads;
  const percentage = limit > 0 ? Math.round((downloadsCount / limit) * 100) : 0;

  let warningSent = previousWarning;
  let warningThresholdSent: 90 | 100 | null = null;

  if (sendWarnings) {
    if (percentage < 90 && warningSent !== 'none') {
      warningSent = 'none';
    }

    if (percentage >= 100 && previousWarning !== 'at100') {
      await sendThresholdWarningEmails({
        organizationId: organization.id,
        organizationName: organization.name,
        threshold: 100,
        downloadsCount,
        limit,
        periodStart,
      });
      warningSent = 'at100';
      warningThresholdSent = 100;
    } else if (percentage >= 90 && previousWarning === 'none') {
      await sendThresholdWarningEmails({
        organizationId: organization.id,
        organizationName: organization.name,
        threshold: 90,
        downloadsCount,
        limit,
        periodStart,
      });
      warningSent = 'at90';
      warningThresholdSent = 90;
    }
  }

  const usageBlocked = isPolarConfigured() ? !organization.overageEnabled && downloadsCount >= limit : false;
  const usageBlockedChanged = usageBlocked !== organization.usageBlocked;

  await db.organization.update({
    where: { id: organization.id },
    data: {
      usagePeriodStart: periodStart,
      usageCalculatedAt: now,
      downloadsCount,
      usageBlocked,
      warningSent,
    },
  });
  if (usageBlockedChanged) {
    await syncManifestFilesForOrganization(organization.id, usageBlocked);
  }

  const polarSynced = syncPolar
    ? await syncOrganizationUsageToPolar({
        organizationId: organization.id,
        periodStart,
        periodEnd,
        downloadsCount,
      })
    : false;

  return {
    snapshot: {
      periodStart: periodStart.toISOString(),
      downloadsCount,
      limit,
      percentage,
      usageBlocked,
      overageEnabled: organization.overageEnabled,
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
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      planKey: true,
      usageBlocked: true,
      overageEnabled: true,
      usagePeriodStart: true,
      usageCalculatedAt: true,
      downloadsCount: true,
      warningSent: true,
    },
  });

  if (!organization) {
    throw new Error('Organization not found');
  }

  return (await refreshUsageForOrganization(organization, new Date(), options)).snapshot;
}

export async function runUsageAggregationCron(): Promise<UsageRunStats> {
  const now = new Date();

  const organizations = await db.organization.findMany({
    select: {
      id: true,
      name: true,
      planKey: true,
      usageBlocked: true,
      overageEnabled: true,
      usagePeriodStart: true,
      usageCalculatedAt: true,
      downloadsCount: true,
      warningSent: true,
    },
  });

  const stats: UsageRunStats = {
    processedOrganizations: 0,
    blockedOrganizations: 0,
    sent90Warnings: 0,
    sent100Warnings: 0,
    polarSyncedOrganizations: 0,
  };

  for (const organization of organizations) {
    try {
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
        organizationId: organization.id,
        error,
      });
    }
  }

  return stats;
}
