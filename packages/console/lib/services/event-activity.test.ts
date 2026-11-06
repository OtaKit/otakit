import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { AUTO_REVERT_REVERTED_BY } from '@/lib/auto-revert-alerts';
import type { EventFilters } from '@/lib/event-filters';
import type { AppEventTimeseriesPoint } from '@/lib/tinybird/events';

import { activityWindow, getEventActivity, OTHER_SEGMENT_KEY } from './event-activity';
import { ROLLOUT_REPLACED_BY } from './releases';

const iso = (value: number) => new Date(value).toISOString();
const at = (value: string) => Date.parse(value);

const NO_FILTERS: EventFilters = {
  platform: null,
  action: null,
  bundleVersion: null,
  channel: undefined,
  runtimeVersion: undefined,
};

type FakeRelease = {
  id: string;
  channel: string | null;
  promotedAt: Date;
  revertedAt: Date | null;
  revertedBy: string | null;
  rolloutPercent: number;
  bundle: { version: string; runtimeVersion: string | null };
};

function fakeDatabase(
  releases: FakeRelease[] = [],
  steps: Array<{ createdAt: Date; metadata: unknown; targetId: string | null }> = [],
) {
  const releaseFindMany = vi.fn(async (args: { where: { id?: { in: string[] } } }) =>
    args.where.id ? releases.filter((release) => args.where.id!.in.includes(release.id)) : releases,
  );
  const auditFindMany = vi.fn(async () => steps);
  const database = {
    release: { findMany: releaseFindMany },
    auditLog: { findMany: auditFindMany },
  } as unknown as PrismaClient;
  return { database, releaseFindMany, auditFindMany };
}

function run(
  points: AppEventTimeseriesPoint[],
  options: {
    splitBy?: 'action' | 'bundle' | 'channel' | 'platform' | 'runtime';
    filters?: EventFilters;
    database?: PrismaClient;
    available?: boolean;
  } = {},
) {
  const readTimeseries = vi.fn(async () => ({
    data: points,
    available: options.available ?? true,
  }));
  return {
    readTimeseries,
    result: getEventActivity(
      {
        organizationId: 'org',
        appId: 'app',
        range: '24h',
        splitBy: options.splitBy ?? 'action',
        tzOffsetMinutes: 0,
        filters: options.filters ?? NO_FILTERS,
      },
      {
        database: options.database ?? fakeDatabase().database,
        now: new Date('2026-11-06T14:10:00.000Z'),
        readTimeseries,
      },
    ),
  };
}

const point = (
  bucket: string,
  action: AppEventTimeseriesPoint['action'],
  count: number,
  segment = '',
): AppEventTimeseriesPoint => ({ bucketStart: at(bucket), action, segment, count });

describe('activityWindow', () => {
  it('starts at the bucket holding the range start and ends after the current bucket', () => {
    const window = activityWindow('24h', at('2026-11-06T14:10:00Z'), 0);
    expect(iso(window.from)).toBe('2026-11-05T14:00:00.000Z');
    expect(iso(window.to)).toBe('2026-11-06T14:30:00.000Z');
    expect(window.count).toBe(49);
    expect(window.shiftMs).toBe(0);
  });

  it('puts day buckets on the viewer clock', () => {
    // UTC+1: local midnight is 23:00 UTC.
    const window = activityWindow('30d', at('2026-11-06T14:10:00Z'), -60);
    expect(iso(window.from)).toBe('2026-10-06T23:00:00.000Z');
    expect(iso(window.to)).toBe('2026-11-06T23:00:00.000Z');
    expect(window.count).toBe(31);
    expect(window.shiftMs).toBe(60 * 60 * 1000);
  });

  it('handles half-hour offsets and offsets west of UTC', () => {
    // UTC+5:30: 3-hour buckets start at local 18:00 = 12:30 UTC.
    const india = activityWindow('7d', at('2026-11-06T14:10:00Z'), -330);
    expect(iso(india.to - india.bucketMs)).toBe('2026-11-06T12:30:00.000Z');
    expect(india.count).toBe(57);
    // UTC-5 minute buckets are the UTC minutes.
    const newYork = activityWindow('1h', at('2026-11-06T14:10:30Z'), 300);
    expect(iso(newYork.from)).toBe('2026-11-06T13:10:00.000Z');
    expect(newYork.count).toBe(61);
  });
});

describe('getEventActivity', () => {
  it('splits by action in device order with totals, zero-filled buckets and the window', async () => {
    const { result, readTimeseries } = run([
      point('2026-11-06T13:00:00Z', 'applied', 4),
      point('2026-11-06T13:00:00Z', 'downloaded', 5),
      point('2026-11-06T14:00:00Z', 'rollback', 1),
      // Outside the window: ignored.
      point('2026-11-05T13:30:00Z', 'downloaded', 9),
    ]);
    const activity = await result;
    expect(readTimeseries).toHaveBeenCalledWith(
      expect.objectContaining({
        from: new Date('2026-11-05T14:00:00.000Z'),
        to: new Date('2026-11-06T14:30:00.000Z'),
        bucketSeconds: 1800,
        shiftSeconds: 0,
        splitBy: 'action',
        channelIsNull: false,
        runtimeVersionIsNull: false,
      }),
    );
    expect(activity.segments.map((segment) => [segment.key, segment.label, segment.total])).toEqual(
      [
        ['downloaded', 'Downloaded', 5],
        ['applied', 'Applied', 4],
        ['rollback', 'Rollback', 1],
      ],
    );
    expect(activity.totals).toEqual({
      downloads: 5,
      applied: 4,
      downloadErrors: 0,
      checkErrors: 0,
      rollbacks: 1,
      rollbackSharePercent: 20,
    });
    expect(activity.buckets).toHaveLength(49);
    expect(activity.buckets[46]).toEqual({
      start: '2026-11-06T13:00:00.000Z',
      counts: [5, 4, 0],
      total: 9,
    });
    expect(activity.buckets[48]).toEqual({
      start: '2026-11-06T14:00:00.000Z',
      counts: [0, 0, 1],
      total: 1,
    });
    expect(activity.buckets[0].total).toBe(0);
    expect(activity.analyticsAvailable).toBe(true);
  });

  it('keeps the five largest split values and folds the rest into Other', async () => {
    const versions = ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7'];
    const { result } = run(
      versions.map((version, index) =>
        point('2026-11-06T13:00:00Z', 'applied', 10 - index, version),
      ),
      { splitBy: 'bundle' },
    );
    const activity = await result;
    expect(activity.segments.map((segment) => [segment.key, segment.total])).toEqual([
      ['1.0', 10],
      ['1.1', 9],
      ['1.2', 8],
      ['1.3', 7],
      ['1.4', 6],
      [OTHER_SEGMENT_KEY, 5 + 4 + 3],
    ]);
    expect(activity.segments.at(-1)).toMatchObject({ label: 'Other (3)', filterValue: null });
    expect(activity.buckets[46].counts).toEqual([10, 9, 8, 7, 6, 12]);
    expect(activity.totals.applied).toBe(52);
  });

  it('labels no channel as base, previews together, no runtime as any, and platforms', async () => {
    const channels = await run(
      [
        point('2026-11-06T13:00:00Z', 'applied', 3, ''),
        point('2026-11-06T13:00:00Z', 'applied', 2, 'beta'),
        // Devices report preview installs under the bare preview channel.
        point('2026-11-06T13:00:00Z', 'applied', 1, '__preview'),
        point('2026-11-06T13:30:00Z', 'applied', 1, '__preview'),
      ],
      { splitBy: 'channel' },
    ).result;
    expect(
      channels.segments.map((segment) => [segment.label, segment.total, segment.filterValue]),
    ).toEqual([
      ['base', 3, 'base'],
      ['beta', 2, 'beta'],
      ['Preview', 2, null],
    ]);

    const runtimes = await run([point('2026-11-06T13:00:00Z', 'applied', 1, '')], {
      splitBy: 'runtime',
    }).result;
    expect(runtimes.segments).toEqual([{ key: '', label: 'any', total: 1, filterValue: null }]);

    const platforms = await run(
      [
        point('2026-11-06T13:00:00Z', 'applied', 1, 'ios'),
        point('2026-11-06T13:00:00Z', 'applied', 2, 'android'),
      ],
      { splitBy: 'platform' },
    ).result;
    expect(platforms.segments.map((segment) => segment.label)).toEqual(['Android', 'iOS']);
  });

  it('reports unavailable analytics instead of zero events', async () => {
    const activity = await run([], { available: false }).result;
    expect(activity.analyticsAvailable).toBe(false);
    expect(activity.segments).toEqual([]);
    expect(activity.totals.rollbackSharePercent).toBeNull();
  });

  it('passes channel and runtime filters through, null meaning none', async () => {
    const { result, readTimeseries } = run([], {
      filters: { ...NO_FILTERS, channel: null, runtimeVersion: 'r2', bundleVersion: '1.4' },
    });
    await result;
    expect(readTimeseries).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: undefined,
        channelIsNull: true,
        runtimeVersion: 'r2',
        runtimeVersionIsNull: false,
        bundleVersion: '1.4',
      }),
    );
  });
});

describe('activity markers', () => {
  const release = (overrides: Partial<FakeRelease>): FakeRelease => ({
    id: 'r1',
    channel: 'production',
    promotedAt: new Date('2026-11-06T10:00:00.000Z'),
    revertedAt: null,
    revertedBy: null,
    rolloutPercent: 100,
    bundle: { version: '1.4.2', runtimeVersion: 'r1' },
    ...overrides,
  });

  it('marks releases, rollout steps and reverts in the range, oldest first', async () => {
    const { database } = fakeDatabase(
      [
        release({}),
        release({
          id: 'r2',
          bundle: { version: '1.4.3', runtimeVersion: 'r1' },
          promotedAt: new Date('2026-11-06T11:00:00.000Z'),
          revertedAt: new Date('2026-11-06T12:00:00.000Z'),
          revertedBy: AUTO_REVERT_REVERTED_BY,
        }),
        // Promoted before the range, cancelled inside it.
        release({
          id: 'r3',
          promotedAt: new Date('2026-11-01T00:00:00.000Z'),
          revertedAt: new Date('2026-11-06T09:00:00.000Z'),
          revertedBy: 'user',
          rolloutPercent: 10,
        }),
        // Replaced by a newer rollout: the newer release carries the marker.
        release({
          id: 'r4',
          promotedAt: new Date('2026-11-01T00:00:00.000Z'),
          revertedAt: new Date('2026-11-06T13:00:00.000Z'),
          revertedBy: ROLLOUT_REPLACED_BY,
          rolloutPercent: 50,
        }),
      ],
      [
        {
          createdAt: new Date('2026-11-06T10:30:00.000Z'),
          metadata: { fromPercent: 10, toPercent: 50 },
          targetId: 'r1',
        },
        {
          createdAt: new Date('2026-11-06T10:45:00.000Z'),
          metadata: { fromPercent: 50, toPercent: 100 },
          targetId: 'r1',
        },
        // A release outside the filters, or of another app.
        {
          createdAt: new Date('2026-11-06T10:50:00.000Z'),
          metadata: { fromPercent: 10, toPercent: 20 },
          targetId: 'elsewhere',
        },
      ],
    );
    const activity = await run([], { database }).result;
    expect(activity.markers.map((marker) => [marker.at, marker.type, marker.label])).toEqual([
      ['2026-11-06T09:00:00.000Z', 'reverted', 'Rollout cancelled'],
      ['2026-11-06T10:00:00.000Z', 'released', 'Released'],
      ['2026-11-06T10:30:00.000Z', 'rollout', 'Rollout 10% → 50%'],
      ['2026-11-06T10:45:00.000Z', 'rollout', 'Rollout complete'],
      ['2026-11-06T11:00:00.000Z', 'released', 'Released'],
      ['2026-11-06T12:00:00.000Z', 'auto_reverted', 'Auto-reverted'],
    ]);
    expect(activity.markers[1]).toMatchObject({
      bundleVersion: '1.4.2',
      channel: 'production',
      runtimeVersion: 'r1',
    });
  });

  it('narrows marker releases by channel, runtime and bundle, not by platform or action', async () => {
    const { database, releaseFindMany, auditFindMany } = fakeDatabase();
    await run([], {
      database,
      filters: {
        platform: 'ios',
        action: 'rollback',
        bundleVersion: '1.4.2',
        channel: null,
        runtimeVersion: null,
      },
    }).result;
    expect(releaseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          appId: 'app',
          channel: null,
          bundle: { is: { version: '1.4.2', runtimeVersion: null } },
          OR: [
            {
              promotedAt: {
                gte: new Date('2026-11-05T14:00:00.000Z'),
                lt: new Date('2026-11-06T14:30:00.000Z'),
              },
            },
            {
              revertedAt: {
                gte: new Date('2026-11-05T14:00:00.000Z'),
                lt: new Date('2026-11-06T14:30:00.000Z'),
              },
            },
          ],
        },
      }),
    );
    expect(auditFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org',
          action: 'release.rollout_updated',
        }),
      }),
    );
  });
});
