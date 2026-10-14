import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const applies = vi.hoisted(() => ({
  all: new Map<string, number>() as Map<string, number> | null,
  capable: new Map<string, number>() as Map<string, number> | null,
  calls: [] as Array<{ ids: string[]; minVersion: unknown }>,
}));

vi.mock('@/lib/tinybird/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tinybird/errors')>()),
  getReleaseCapableApplies: vi.fn(
    async (_appId: string, ids: string[], minVersion: { major: number; minor: number }) => {
      applies.calls.push({ ids, minVersion });
      return minVersion.major === 0 ? applies.all : applies.capable;
    },
  ),
}));

const { db } = await import('@/lib/db');
const { getRolloutReach } = await import('./rollout-reach');

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

databaseDescribe('rollout reach (PostgreSQL integration)', () => {
  let organizationId: string;
  let appId: string;
  const ctx = () => ({ organizationId, appId });

  beforeEach(async () => {
    applies.all = new Map();
    applies.capable = new Map();
    applies.calls = [];
    organizationId = randomUUID();
    appId = randomUUID();
    await db.organization.create({
      data: {
        id: organizationId,
        name: 'Reach',
        apps: { create: { id: appId, slug: `reach.${organizationId}` } },
      },
    });
  });

  afterEach(async () => {
    await db.organization.delete({ where: { id: organizationId } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('measures the share of applies from plugins older than 3.1 on the lane', async () => {
    expect(await getRolloutReach(ctx(), { channel: 'production', runtimeVersion: null })).toEqual({
      applies: 0,
      rolloutCapableApplies: 0,
      olderShare: null,
      analyticsAvailable: true,
    });

    const bundle = (runtimeVersion: string | null) =>
      db.bundle.create({
        data: {
          appId,
          version: randomUUID().slice(0, 8),
          sha256: 'a'.repeat(64),
          storageKey: 'k',
          size: 1,
          runtimeVersion,
        },
      });
    const lane = await bundle(null);
    const otherRuntime = await bundle('2');
    const ids: string[] = [];
    for (let day = 1; day <= 6; day += 1) {
      const release = await db.release.create({
        data: {
          appId,
          bundleId: lane.id,
          channel: 'production',
          promotedAt: new Date(`2026-10-0${day}T10:00:00.000Z`),
        },
      });
      ids.push(release.id);
    }
    await db.release.create({
      data: { appId, bundleId: otherRuntime.id, channel: 'production' },
    });
    await db.release.create({ data: { appId, bundleId: lane.id, channel: 'beta' } });
    applies.all = new Map([
      [ids[5], 300],
      [ids[4], 100],
    ]);
    applies.capable = new Map([
      [ids[5], 280],
      [ids[4], 60],
    ]);
    const reach = await getRolloutReach(ctx(), { channel: 'production', runtimeVersion: null });
    expect(reach).toEqual({
      applies: 400,
      rolloutCapableApplies: 340,
      olderShare: 0.15,
      analyticsAvailable: true,
    });
    // The 5 latest releases of exactly this lane, with 0.0 and 3.1 as the oldest plugins.
    expect(applies.calls.map((call) => call.minVersion)).toEqual([
      { major: 0, minor: 0 },
      { major: 3, minor: 1 },
    ]);
    expect([...applies.calls[0].ids].sort()).toEqual([...ids.slice(1)].sort());

    applies.capable = null;
    expect(
      await getRolloutReach(ctx(), { channel: 'production', runtimeVersion: null }),
    ).toMatchObject({ analyticsAvailable: false, olderShare: null });
    await expect(
      getRolloutReach(
        { organizationId: randomUUID(), appId },
        { channel: null, runtimeVersion: null },
      ),
    ).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
  });
});
