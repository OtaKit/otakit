import { db } from '@/lib/db';
import { createEmptyEventCounts, getReleaseEventCounts } from '@/lib/tinybird/events';

export async function getRNBundleSummaries(appId: string) {
  const bundles = await db.bundle.findMany({
    where: { appId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      version: true,
      platform: true,
      runtimeVersion: true,
      size: true,
      createdAt: true,
    },
  });
  const releases = await db.release.findMany({
    where: { appId },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      bundleId: true,
      platform: true,
      runtimeVersion: true,
      channel: true,
      revertedAt: true,
      promotedAt: true,
    },
  });
  const counts = await getReleaseEventCounts(
    appId,
    releases.map((release) => release.id),
  );
  const active = new Set<string>();
  const rows = new Map(
    bundles.map((bundle) => [
      bundle.id,
      {
        ...bundle,
        createdAt: bundle.createdAt.toISOString(),
        isLive: false,
        currentTargets: [] as Array<{
          platform: string;
          runtimeVersion: string | null;
          channel: string | null;
        }>,
        deployedTargets: [] as Array<{
          platform: string;
          runtimeVersion: string | null;
          channel: string | null;
          deployedAt: string;
        }>,
        eventCounts: createEmptyEventCounts(),
      },
    ]),
  );
  const deployed = new Set<string>();
  for (const release of releases) {
    const row = rows.get(release.bundleId);
    if (!row) continue;
    const target = {
      platform: release.platform,
      runtimeVersion: release.runtimeVersion,
      channel: release.channel,
    };
    const key = JSON.stringify([target.platform, target.runtimeVersion, target.channel]);
    const historyKey = JSON.stringify([release.bundleId, key]);
    if (!deployed.has(historyKey)) {
      row.deployedTargets.push({ ...target, deployedAt: release.promotedAt.toISOString() });
      deployed.add(historyKey);
    }
    if (release.revertedAt === null && !active.has(key)) {
      row.currentTargets.push(target);
      row.isLive ||= target.channel === null;
      active.add(key);
    }
    const events = counts.get(release.id) ?? createEmptyEventCounts();
    for (const type of ['downloads', 'applied', 'downloadErrors', 'rollbacks'] as const)
      row.eventCounts[type] += events[type];
  }
  return { bundles: [...rows.values()] };
}
