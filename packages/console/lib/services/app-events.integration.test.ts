import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AppEventNameCounts,
  AppEventReleaseCounts,
  LiveAppEvent,
} from '@/lib/tinybird/app-events';

const tinybird = vi.hoisted(() => ({
  names: [] as AppEventNameCounts[],
  widerNames: [] as AppEventNameCounts[],
  series: new Map<string, Array<{ start: string; events: number; sessions: number }>>(),
  live: [] as LiveAppEvent[],
  releaseCounts: new Map<string, AppEventReleaseCounts>(),
  applies: new Map<string, number>(),
  breakdown: {
    values: [] as Array<{ value: string; events: number; sessions: number }>,
    total: { events: 0, sessions: 0 },
  },
}));
const calls = vi.hoisted(() => ({ names: [] as Array<Record<string, unknown>> }));

vi.mock('@/lib/tinybird/app-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tinybird/app-events')>()),
  listAppEventNames: vi.fn(async (filters: Record<string, unknown>) => {
    calls.names.push(filters);
    const wider =
      (filters.to as Date).getTime() - (filters.from as Date).getTime() > 30 * 86_400_000;
    return { data: wider ? tinybird.widerNames : tinybird.names, available: true };
  }),
  getAppEventTimeseries: vi.fn(async () => ({ data: tinybird.series, available: true })),
  listLiveAppEvents: vi.fn(async () => ({ data: tinybird.live, available: true })),
  getAppEventReleaseCounts: vi.fn(async () => ({ data: tinybird.releaseCounts, available: true })),
  getAppEventBreakdown: vi.fn(async () => ({ data: tinybird.breakdown, available: true })),
  getAppEventUsage: vi.fn(async () => new Map()),
}));
vi.mock('@/lib/tinybird/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tinybird/errors')>()),
  getReleaseCapableApplies: vi.fn(async () => tinybird.applies),
}));

const { db } = await import('@/lib/db');
const events = await import('./app-events');

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;
const NOW = new Date('2026-10-14T12:34:00.000Z');

databaseDescribe('custom events (PostgreSQL integration)', () => {
  let organizationId: string;
  let appId: string;
  const ctx = () => ({ organizationId, appId });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('POLAR_ACCESS_TOKEN', '');
    calls.names = [];
    tinybird.names = [];
    tinybird.widerNames = [];
    tinybird.series = new Map();
    tinybird.live = [];
    tinybird.releaseCounts = new Map();
    tinybird.applies = new Map();
    organizationId = randomUUID();
    appId = randomUUID();
    await db.organization.create({
      data: {
        id: organizationId,
        name: 'Events',
        apps: { create: { id: appId, slug: `events.${organizationId}` } },
      },
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.organization.delete({ where: { id: organizationId } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('lists events with their change, and app launches apart', async () => {
    tinybird.names = [
      { name: 'checkout_completed', events: 120, sessions: 80, previousEvents: 100 },
      { name: '$session_start', events: 900, sessions: 880, previousEvents: 850 },
      { name: 'signup', events: 0, sessions: 0, previousEvents: 4 },
      { name: 'new_feature', events: 7, sessions: 7, previousEvents: 0 },
    ];
    tinybird.series = new Map([['signup', [{ start: 'x', events: 1, sessions: 1 }]]]);
    const list = await events.listAppEvents(ctx(), { range: '24h', includeTrend: true }, NOW);
    expect(list).toMatchObject({
      sessions: 880,
      hasEvents: true,
      analyticsAvailable: true,
      range: {
        name: '24h',
        from: '2026-10-13T13:00:00.000Z',
        to: '2026-10-14T13:00:00.000Z',
        bucket: 'hour',
      },
    });
    expect(
      list.events.map((event) => [event.name, event.changePercent, event.trend?.length]),
    ).toEqual([
      ['checkout_completed', 20, 0],
      ['signup', -100, 1],
      ['new_feature', null, 0],
    ]);
    expect(calls.names[0]).toMatchObject({
      previousFrom: new Date('2026-10-12T13:00:00.000Z'),
    });
  });

  it('looks back 90 days before showing the setup', async () => {
    expect((await events.listAppEvents(ctx(), {}, NOW)).hasEvents).toBe(false);
    tinybird.widerNames = [{ name: 'old', events: 1, sessions: 1, previousEvents: 0 }];
    const list = await events.listAppEvents(ctx(), {}, NOW);
    expect(list).toMatchObject({ hasEvents: true, events: [], sessions: null });
  });

  it('returns one event with every bucket and its property keys', async () => {
    tinybird.names = [{ name: 'checkout_completed', events: 3, sessions: 2, previousEvents: 0 }];
    tinybird.series = new Map([
      ['checkout_completed', [{ start: '2026-10-14T10:00:00.000Z', events: 3, sessions: 2 }]],
    ]);
    const live = (properties: Record<string, string>) =>
      ({ properties }) as unknown as LiveAppEvent;
    tinybird.live = [live({ plan: 'pro', value: '49' }), live({ plan: 'free' }), live({})];
    const detail = await events.getAppEvent(ctx(), 'checkout_completed', { range: '24h' }, NOW);
    expect(detail.series).toHaveLength(24);
    expect(detail.series.find((bucket) => bucket.events > 0)).toEqual({
      start: '2026-10-14T10:00:00.000Z',
      events: 3,
      sessions: 2,
    });
    expect(detail.propertyKeys).toEqual(['plan', 'value']);
    await expect(events.getAppEvent(ctx(), 'missing', {}, NOW)).rejects.toMatchObject({
      code: 'APP_EVENT_NOT_FOUND',
      status: 404,
    });
    await expect(events.getAppEvent(ctx(), 'bad name', {}, NOW)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(
      (await events.getAppEvent(ctx(), 'checkout_completed', { range: '30d' }, NOW)).series,
    ).toHaveLength(30);
  });

  it('splits by a property with the rest as other', async () => {
    tinybird.breakdown = {
      values: [
        { value: 'pro', events: 60, sessions: 40 },
        { value: '', events: 20, sessions: 20 },
      ],
      total: { events: 100, sessions: 70 },
    };
    const result = await events.getAppEventPropertyBreakdown(ctx(), 'checkout_completed', 'plan');
    expect(result.values).toEqual([
      { value: 'pro', events: 60, sessions: 40, share: 60 },
      { value: '', events: 20, sessions: 20, share: 20 },
    ]);
    expect(result.other).toEqual({ events: 20, share: 20 });
    await expect(
      events.getAppEventPropertyBreakdown(ctx(), 'checkout_completed', 'a b'),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('compares releases per 1,000 app launches, or applies without session events', async () => {
    const bundle = await db.bundle.create({
      data: { appId, version: '1.0.0', sha256: 'a'.repeat(64), storageKey: 'k', size: 1 },
    });
    const release = (version: string, day: number, channel = 'production') =>
      db.release.create({
        data: {
          appId,
          bundleId: bundle.id,
          channel,
          promotedAt: new Date(`2026-10-0${day}T10:00:00.000Z`),
        },
        select: { id: true },
      });
    const r0 = await release('none', 1);
    const r1 = await release('a', 1);
    const r2 = await release('b', 2);
    await release('c', 3, '__preview_abcdefghijklmnopqrstuvwxyz');
    tinybird.releaseCounts = new Map([
      [r1.id, { events: 10, sessions: 9, allSessions: 1000 }],
      [r2.id, { events: 30, sessions: 25, allSessions: 2000 }],
    ]);
    const bySessions = await events.compareAppEventReleases(ctx(), 'checkout_completed');
    expect(bySessions.basis).toBe('sessions');
    // A release without any data is left out, and is never the baseline.
    expect(bySessions.releases.map((row) => row.releaseId)).not.toContain(r0.id);
    expect(
      bySessions.releases.map((row) => [row.releaseId, row.perThousand, row.differencePercent]),
    ).toEqual([
      [r1.id, 10, null],
      [r2.id, 15, 50],
    ]);

    tinybird.releaseCounts.set(r2.id, { events: 30, sessions: 25, allSessions: 0 });
    tinybird.applies = new Map([
      [r1.id, 500],
      [r2.id, 1500],
    ]);
    const byApplies = await events.compareAppEventReleases(ctx(), 'checkout_completed');
    expect(byApplies.basis).toBe('applies');
    expect(byApplies.releases.map((row) => row.perThousand)).toEqual([20, 20]);
    await expect(
      events.compareAppEventReleases(ctx(), 'x', {
        releaseIds: Array.from({ length: 11 }, () => 'r'),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
