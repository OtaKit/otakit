import { describe, expect, it } from 'vitest';

import type { EventActivity } from '@/lib/event-activity-types';
import { AUTO_REVERT_REVERTED_BY } from '@/lib/release-actors';

import { DemoConsole } from './api';
import { DEMO_APPS, DEMO_BROKEN_VERSION, DEMO_NEXT_VERSION } from './scenario';
import type { DemoChange } from './world';

const NOW = Date.parse('2026-11-06T14:00:00.000Z');
const APP = DEMO_APPS[0].id;
const SECOND = 1000;

async function call(demo: DemoConsole, method: string, path: string, now: number, body?: unknown) {
  return demo.handle(
    method,
    new URL(`https://console.example/api/v1/apps/${APP}${path}`),
    body,
    now,
  );
}

describe('demo history', () => {
  const started = performance.now();
  const demo = new DemoConsole(NOW);
  const elapsed = performance.now() - started;
  const world = demo.worlds[0];

  it('builds a month of history quickly and deterministically', () => {
    console.info(`demo history: ${world.events.length} events in ${Math.round(elapsed)} ms`);
    expect(world.events.length).toBeGreaterThan(200_000);
    expect(world.events.length).toBeLessThan(900_000);
    expect(new DemoConsole(NOW).worlds[0].events.length).toBe(world.events.length);
  });

  it('auto-reverts the broken 2.2.0 and ends with 2.3.0 rolled out on base', async () => {
    const { body } = await call(demo, 'GET', '/releases?limit=100', NOW);
    const releases = (body as { releases: Array<Record<string, unknown>> }).releases;
    const broken = releases.find((r) => r.bundleVersion === '2.2.0' && r.channel === null)!;
    expect(broken.revertedBy).toBe(AUTO_REVERT_REVERTED_BY);
    const revertedAfter =
      Date.parse(String(broken.revertedAt)) - Date.parse(String(broken.promotedAt));
    expect(revertedAfter).toBeLessThan(12 * 60 * 60 * SECOND);
    const latest = releases.find((r) => r.channel === null && r.runtimeVersion === '5.0')!;
    expect(latest).toMatchObject({ bundleVersion: '2.3.0', rolloutPercent: 100, revertedAt: null });

    const summary = (await call(demo, 'GET', '/bundles/summary', NOW)).body as {
      bundles: Array<{ version: string; isLive: boolean; currentTargets: unknown[] }>;
    };
    const live = summary.bundles.filter((b) => b.isLive).map((b) => b.version);
    expect(live.sort()).toEqual(['1.9.7', '2.3.0']);
    expect(
      summary.bundles.find((b) => b.version === DEMO_NEXT_VERSION)?.currentTargets,
    ).toHaveLength(2);
  });

  it('serves the event list newest first and a zero-filled activity chart', async () => {
    const events = (await call(demo, 'GET', '/events?timeframe=24h&limit=50', NOW)).body as {
      events: Array<{ createdAt: string }>;
    };
    expect(events.events).toHaveLength(50);
    const times = events.events.map((e) => Date.parse(e.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const activity = (await call(demo, 'GET', '/events/timeseries?range=24h&tzOffset=0', NOW))
      .body as EventActivity;
    expect(activity.buckets).toHaveLength(49);
    expect(activity.totals.downloads).toBeGreaterThan(1000);
    expect(activity.markers.some((m) => m.bundleVersion === '2.3.0' && m.type === 'rollout')).toBe(
      true,
    );
    const byBundle = (
      await call(demo, 'GET', '/events/timeseries?range=7d&splitBy=bundle&channel=base', NOW)
    ).body as EventActivity;
    expect(byBundle.segments.map((s) => s.label)).toContain('2.3.0');
  });
});

describe('demo changes', () => {
  it('releases, rolls out and catches the broken bundle with auto-revert', async () => {
    const demo = new DemoConsole(NOW);
    const world = demo.worlds[0];
    const changes: DemoChange[] = [];
    world.subscribe((change) => changes.push(change));
    const bundles = (await call(demo, 'GET', '/bundles/summary', NOW)).body as {
      bundles: Array<{ id: string; version: string }>;
    };
    const idOf = (version: string) => bundles.bundles.find((b) => b.version === version)!.id;
    const currentBase = async (now: number) => {
      const { releases } = (await call(demo, 'GET', '/releases?limit=100', now)).body as {
        releases: Array<{
          id: string;
          channel: string | null;
          runtimeVersion: string;
          revertedAt: string | null;
        }>;
      };
      return releases.find(
        (r) => r.channel === null && r.runtimeVersion === '5.0' && !r.revertedAt,
      )!.id;
    };

    // Rules the real service enforces.
    const again = await call(demo, 'POST', '/releases', NOW, {
      bundleId: idOf('2.3.0'),
      channel: null,
      expectedCurrentReleaseId: await currentBase(NOW),
    });
    expect(again).toMatchObject({
      status: 409,
      body: { error: 'Bundle is already current for this release lane' },
    });
    const firstOnLane = await call(demo, 'POST', '/releases', NOW, {
      bundleId: idOf(DEMO_NEXT_VERSION),
      channel: 'qa',
      expectedCurrentReleaseId: null,
      rolloutPercent: 10,
    });
    expect(firstOnLane.body).toEqual({ error: 'The first release on a lane goes to every device' });

    // 2.4.0 to base at 10%: about a tenth of base devices move within minutes.
    let now = NOW + 10 * SECOND;
    const stableDownloads = () => world.bundleByVersion('2.3.0')!.counts.downloads;
    const stableBefore = stableDownloads();
    const released = await call(demo, 'POST', '/releases', now, {
      bundleId: idOf(DEMO_NEXT_VERSION),
      channel: null,
      expectedCurrentReleaseId: await currentBase(now),
      rolloutPercent: 10,
    });
    expect(released.status).toBe(201);
    expect(changes.at(-1)).toMatchObject({
      type: 'released',
      bundleVersion: DEMO_NEXT_VERSION,
      rolloutPercent: 10,
    });
    now += 5 * 60 * SECOND;
    world.advanceTo(now);
    const downloads = world.bundles.find((b) => b.version === DEMO_NEXT_VERSION)!.counts.downloads;
    expect(downloads).toBeGreaterThan(1000);
    expect(downloads).toBeLessThan(6000);
    // The other 90% keep moving to 2.3.0 at their real pace, not 60× faster.
    expect(stableDownloads() - stableBefore).toBeLessThan(600);

    const rollout = await call(demo, 'PATCH', `/releases/${await currentBase(now)}/rollout`, now, {
      percent: 100,
      expectedPercent: 10,
    });
    expect(rollout.status).toBe(200);
    expect(changes.at(-1)).toMatchObject({ type: 'rollout', rolloutPercent: 100 });

    // 2.4.1 crashes on launch: auto-revert reverts it within a minute.
    now += 30 * SECOND;
    await call(demo, 'POST', '/releases', now, {
      bundleId: idOf(DEMO_BROKEN_VERSION),
      channel: null,
      expectedCurrentReleaseId: await currentBase(now),
      autoRevert: true,
      autoRevertRatePercent: 20,
      autoRevertMinSample: 50,
    });
    for (let i = 1; i <= 60 && !changes.some((c) => c.type === 'auto_reverted'); i += 1) {
      world.advanceTo(now + i * SECOND);
    }
    const reverted = changes.find((c) => c.type === 'auto_reverted');
    expect(reverted).toMatchObject({ bundleVersion: DEMO_BROKEN_VERSION, channel: null });
    expect(reverted!.rollbackSharePercent).toBeGreaterThanOrEqual(20);
  });

  it('refuses to connect apps and answers unknown paths', async () => {
    const demo = new DemoConsole(NOW);
    const connect = await demo.handle(
      'POST',
      new URL('https://console.example/api/v1/apps'),
      { slug: 'x' },
      NOW,
    );
    expect(connect.status).toBe(403);
    expect((await call(demo, 'GET', '/channels', NOW)).status).toBe(404);
  });
});
