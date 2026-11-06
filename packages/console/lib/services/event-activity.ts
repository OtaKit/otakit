import type { Prisma, PrismaClient } from '@prisma/client';

import { db } from '@/lib/db';
import {
  activityWindow,
  buildActivityMarkers,
  buildEventActivity,
  MAX_ACTIVITY_MARKERS,
  type MarkerRelease,
} from '@/lib/event-activity-core';
import type { EventFilters } from '@/lib/event-filters';
import type {
  EventActivity,
  EventActivityMarker,
  EventActivityRange,
  EventActivitySplit,
} from '@/lib/event-activity-types';
import { getAppEventTimeseries } from '@/lib/tinybird/events';

export {
  EVENT_ACTIVITY_RANGES,
  EVENT_ACTIVITY_SPLITS,
  OTHER_SEGMENT_KEY,
  isEventActivityRange,
  isEventActivitySplit,
} from '@/lib/event-activity-types';
export type {
  EventActivity,
  EventActivityRange,
  EventActivitySplit,
} from '@/lib/event-activity-types';
export { activityWindow } from '@/lib/event-activity-core';

/**
 * An app's device activity over time, for the chart above the event list: event
 * counts per bucket under the list's filters, split by one dimension, with the
 * releases, rollout steps and reverts of the range as markers. The chart's
 * shape comes from event-activity-core, which the dashboard demo shares.
 */

export async function getEventActivity(
  input: {
    organizationId: string;
    appId: string;
    range: EventActivityRange;
    splitBy: EventActivitySplit;
    tzOffsetMinutes: number;
    filters: EventFilters;
  },
  dependencies: {
    database?: PrismaClient;
    now?: Date;
    readTimeseries?: typeof getAppEventTimeseries;
  } = {},
): Promise<EventActivity> {
  const database = dependencies.database ?? db;
  const readTimeseries = dependencies.readTimeseries ?? getAppEventTimeseries;
  const now = (dependencies.now ?? new Date()).getTime();
  const { range, splitBy, filters } = input;
  const window = activityWindow(range, now, input.tzOffsetMinutes);

  const [analytics, markers] = await Promise.all([
    readTimeseries({
      appId: input.appId,
      from: new Date(window.from),
      to: new Date(window.to),
      bucketSeconds: window.bucketMs / 1000,
      shiftSeconds: window.shiftMs / 1000,
      splitBy,
      platform: filters.platform,
      action: filters.action,
      bundleVersion: filters.bundleVersion,
      channel: filters.channel ?? undefined,
      channelIsNull: filters.channel === null,
      runtimeVersion: filters.runtimeVersion ?? undefined,
      runtimeVersionIsNull: filters.runtimeVersion === null,
    }),
    activityMarkers(database, input.organizationId, input.appId, filters, window.from, window.to),
  ]);

  return buildEventActivity({
    range,
    splitBy,
    window,
    now,
    points: analytics.data,
    available: analytics.available,
    markers,
  });
}

const markerReleaseSelect = {
  id: true,
  channel: true,
  promotedAt: true,
  revertedAt: true,
  revertedBy: true,
  rolloutPercent: true,
  bundle: { select: { version: true, runtimeVersion: true } },
} satisfies Prisma.ReleaseSelect;

function toMarkerRelease(
  release: Prisma.ReleaseGetPayload<{ select: typeof markerReleaseSelect }>,
): MarkerRelease {
  return {
    channel: release.channel,
    promotedAt: release.promotedAt,
    revertedAt: release.revertedAt,
    revertedBy: release.revertedBy,
    rolloutPercent: release.rolloutPercent,
    bundleVersion: release.bundle.version,
    runtimeVersion: release.bundle.runtimeVersion,
  };
}

/**
 * Releases, rollout steps and reverts within [from, to) of the releases the
 * filters can see (channel, runtime and bundle; platform and action do not
 * narrow releases), oldest first.
 */
async function activityMarkers(
  database: PrismaClient,
  organizationId: string,
  appId: string,
  filters: EventFilters,
  from: number,
  to: number,
): Promise<EventActivityMarker[]> {
  const bundle: Prisma.BundleWhereInput = {
    ...(filters.bundleVersion ? { version: filters.bundleVersion } : {}),
    ...(filters.runtimeVersion !== undefined ? { runtimeVersion: filters.runtimeVersion } : {}),
  };
  const releaseWhere: Prisma.ReleaseWhereInput = {
    appId,
    ...(filters.channel !== undefined ? { channel: filters.channel } : {}),
    ...(Object.keys(bundle).length > 0 ? { bundle: { is: bundle } } : {}),
  };
  const inRange = { gte: new Date(from), lt: new Date(to) };

  const [releases, steps] = await Promise.all([
    database.release.findMany({
      where: { ...releaseWhere, OR: [{ promotedAt: inRange }, { revertedAt: inRange }] },
      orderBy: [{ promotedAt: 'asc' }, { id: 'asc' }],
      take: MAX_ACTIVITY_MARKERS,
      select: markerReleaseSelect,
    }),
    database.auditLog.findMany({
      where: { organizationId, action: 'release.rollout_updated', createdAt: inRange },
      orderBy: { createdAt: 'asc' },
      take: MAX_ACTIVITY_MARKERS,
      select: { createdAt: true, metadata: true, targetId: true },
    }),
  ]);

  const stepTargets = [...new Set(steps.map((step) => step.targetId).filter(Boolean))] as string[];
  const stepReleases = stepTargets.length
    ? await database.release.findMany({
        where: { ...releaseWhere, id: { in: stepTargets } },
        select: markerReleaseSelect,
      })
    : [];
  const stepRelease = new Map(
    stepReleases.map((release) => [release.id, toMarkerRelease(release)]),
  );

  return buildActivityMarkers({
    releases: releases.map(toMarkerRelease),
    steps: steps.map((step) => {
      const metadata = (step.metadata ?? {}) as { fromPercent?: unknown; toPercent?: unknown };
      return {
        at: step.createdAt,
        release: step.targetId ? stepRelease.get(step.targetId) : undefined,
        fromPercent: metadata.fromPercent,
        toPercent: metadata.toPercent,
      };
    }),
    from,
    to,
  });
}
