import { db } from '@/lib/db';
import { getReleaseCapableApplies } from '@/lib/tinybird/errors';

import { OtaKitServiceError } from './errors';

/**
 * How much of a lane a rollout can reach: devices pick rollouts from plugin
 * 3.1, and older plugins keep the stable release until the rollout completes.
 * Measured from applies of the lane's latest releases (raw events, 90 days),
 * which approximate the devices that update; they are events, not devices.
 */

const RECENT_RELEASES = 5;
const ROLLOUT_PLUGIN = { major: 3, minor: 1 } as const;

export type RolloutReach = {
  /** Applies of the lane's latest releases in the last 90 days. */
  applies: number;
  /** Of those, applies from plugin 3.1 or later. */
  rolloutCapableApplies: number;
  /** Share of applies from older plugins, 0-1; null without applies. */
  olderShare: number | null;
  analyticsAvailable: boolean;
};

export async function getRolloutReach(
  ctx: { organizationId: string; appId: string },
  lane: { channel: string | null; runtimeVersion: string | null },
): Promise<RolloutReach> {
  const app = await db.app.findFirst({
    where: { id: ctx.appId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!app) throw new OtaKitServiceError('APP_NOT_FOUND', 'App not found', 404);
  const releases = await db.release.findMany({
    where: {
      appId: ctx.appId,
      channel: lane.channel,
      bundle: { runtimeVersion: lane.runtimeVersion },
    },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    take: RECENT_RELEASES,
    select: { id: true },
  });
  const ids = releases.map((release) => release.id);
  if (ids.length === 0) {
    return { applies: 0, rolloutCapableApplies: 0, olderShare: null, analyticsAvailable: true };
  }
  const [all, capable] = await Promise.all([
    getReleaseCapableApplies(ctx.appId, ids, { major: 0, minor: 0 }),
    getReleaseCapableApplies(ctx.appId, ids, ROLLOUT_PLUGIN),
  ]);
  if (!all || !capable) {
    return { applies: 0, rolloutCapableApplies: 0, olderShare: null, analyticsAvailable: false };
  }
  const sum = (values: Map<string, number>) =>
    [...values.values()].reduce((total, value) => total + value, 0);
  const applies = sum(all);
  const rolloutCapableApplies = Math.min(applies, sum(capable));
  return {
    applies,
    rolloutCapableApplies,
    olderShare:
      applies > 0 ? Math.round(((applies - rolloutCapableApplies) / applies) * 1000) / 1000 : null,
    analyticsAvailable: true,
  };
}
