import { getOrganizationEntitlements } from '@/lib/billing/service';
import { db } from '@/lib/db';
import { utcMonth } from '@/lib/error-tracking';
import { isPolarConfigured } from '@/lib/polar';
import { cachedJson } from '@/lib/redis';
import { getAppEventUsage } from '@/lib/tinybird/app-events';
import { getAppErrorUsage } from '@/lib/tinybird/errors';

import { OtaKitServiceError } from './errors';

export type TelemetryUsageStatus = {
  /** Events of the kind this UTC month; null when analytics are unavailable. */
  events: number | null;
  /** Null without a limit (Enterprise, or a server without billing). */
  limit: number | null;
  /** New events of the kind are dropped until then. */
  pausedUntil: string | null;
};

const KINDS = {
  error: { usage: getAppErrorUsage, field: 'errorsPausedUntil', limit: 'errorEvents' },
  event: { usage: getAppEventUsage, field: 'eventsPausedUntil', limit: 'appEvents' },
} as const;

/** A workspace's monthly usage of error events or custom events, for banners and agents. */
export async function getTelemetryUsageStatus(
  organizationId: string,
  kind: keyof typeof KINDS,
  now: Date = new Date(),
): Promise<TelemetryUsageStatus> {
  const config = KINDS[kind];
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      errorsPausedUntil: true,
      eventsPausedUntil: true,
      apps: { select: { id: true } },
    },
  });
  if (!organization) {
    throw new OtaKitServiceError('ORGANIZATION_NOT_FOUND', 'Workspace not found', 404);
  }
  const paused = organization[config.field];
  const pausedUntil = paused && paused > now ? paused.toISOString() : null;
  let limit: number | null = null;
  if (isPolarConfigured()) {
    const value = (await getOrganizationEntitlements(organizationId)).limits[config.limit];
    limit = value >= Number.MAX_SAFE_INTEGER ? null : value;
  }
  const month = utcMonth(now);
  const appIds = organization.apps.map((app) => app.id);
  const events =
    appIds.length === 0
      ? 0
      : await cachedJson(
          `otakit:${kind}s:usage:${organizationId}:${month.start.toISOString().slice(0, 7)}`,
          60,
          async () => {
            const usage = await config.usage({ ...month, appIds });
            if (!usage) throw new Error('Usage unavailable');
            return Array.from(usage.values()).reduce((sum, value) => sum + value, 0);
          },
        ).catch(() => null);
  return { events, limit, pausedUntil };
}
