import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import type { getReleaseEventTimeseries } from '@/lib/tinybird/events';

import { getReleaseTimeseries, isReleaseTimeseriesRange } from './release-timeseries';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

const NOW = new Date('2026-09-10T10:30:00.000Z');
const at = (iso: string) => new Date(iso);
const ms = (iso: string) => Date.parse(iso);

databaseDescribe('release timeseries (PostgreSQL integration)', () => {
  let organizationId: string;
  let appId: string;
  let bundleIds: string[];
  let readTimeseries: ReturnType<typeof vi.fn<typeof getReleaseEventTimeseries>>;

  beforeEach(async () => {
    organizationId = randomUUID();
    appId = randomUUID();
    bundleIds = Array.from({ length: 8 }, () => randomUUID());
    await db.organization.create({
      data: {
        id: organizationId,
        name: 'Timeseries',
        apps: {
          create: {
            id: appId,
            slug: `timeseries.${organizationId}`,
            bundles: {
              create: bundleIds.map((id, index) => ({
                id,
                version: `1.0.${index}`,
                sha256: String(index).padStart(64, '0'),
                storageKey: `timeseries/${organizationId}/${index}.zip`,
                size: 100,
                runtimeVersion: index === 7 ? 'other-runtime' : 'ios-1',
              })),
            },
          },
        },
      },
    });
    readTimeseries = vi.fn<typeof getReleaseEventTimeseries>().mockResolvedValue({
      data: [],
      available: true,
    });
  });

  afterEach(async () => {
    await db.organization.delete({ where: { id: organizationId } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  function release(index: number, data: Record<string, unknown> = {}) {
    return db.release.create({
      data: {
        appId,
        bundleId: bundleIds[index],
        channel: 'production',
        promotedAt: at('2026-09-01T00:00:00.000Z'),
        ...data,
      },
    });
  }

  function timeseries(releaseId: string, extra: Record<string, unknown> = {}) {
    return getReleaseTimeseries(
      { organizationId, appId, releaseId, ...extra },
      { now: NOW, readTimeseries },
    );
  }

  it('zero-fills hourly buckets ending with the current hour and adds up the counts', async () => {
    const { id } = await release(0, { promotedAt: at('2026-09-09T12:00:00.000Z') });
    readTimeseries.mockResolvedValue({
      available: true,
      data: [
        {
          releaseId: id,
          action: 'downloaded',
          bucketStart: ms('2026-09-10T09:00:00Z'),
          count: 5,
          lastReceivedAt: ms('2026-09-10T09:40:00Z'),
        },
        {
          releaseId: id,
          action: 'applied',
          bucketStart: ms('2026-09-10T10:00:00Z'),
          count: 3,
          lastReceivedAt: ms('2026-09-10T10:20:00Z'),
        },
        {
          releaseId: id,
          action: 'rollback',
          bucketStart: ms('2026-09-10T10:00:00Z'),
          count: 1,
          lastReceivedAt: ms('2026-09-10T10:05:00Z'),
        },
        {
          releaseId: id,
          action: 'applied',
          bucketStart: ms('2026-09-09T10:00:00Z'),
          count: 99,
          lastReceivedAt: ms('2026-09-09T10:00:00Z'),
        },
      ],
    });

    const result = await timeseries(id);

    expect(readTimeseries).toHaveBeenCalledWith({
      appId,
      releaseIds: [id],
      from: at('2026-09-09T11:00:00.000Z'),
      to: at('2026-09-10T11:00:00.000Z'),
      daily: false,
      platform: null,
    });
    expect(result).toMatchObject({
      range: '24h',
      granularity: 'hour',
      asOf: NOW.toISOString(),
      from: '2026-09-09T11:00:00.000Z',
      to: '2026-09-10T11:00:00.000Z',
      unit: 'events',
      analyticsAvailable: true,
      lastEventAt: '2026-09-10T10:20:00.000Z',
      totals: {
        downloads: 5,
        applied: 3,
        downloadErrors: 0,
        rollbacks: 1,
        rollbackSharePercent: 25,
      },
    });
    expect(result.buckets).toHaveLength(24);
    expect(result.buckets[0]).toEqual({
      start: '2026-09-09T11:00:00.000Z',
      downloads: 0,
      applied: 0,
      downloadErrors: 0,
      rollbacks: 0,
      appliedTotal: 0,
    });
    expect(result.buckets.slice(-2)).toEqual([
      expect.objectContaining({ start: '2026-09-10T09:00:00.000Z', downloads: 5, appliedTotal: 0 }),
      expect.objectContaining({
        start: '2026-09-10T10:00:00.000Z',
        applied: 3,
        rollbacks: 1,
        appliedTotal: 3,
      }),
    ]);
    expect(result.markers).toEqual([
      { at: '2026-09-09T12:00:00.000Z', type: 'released', label: 'Released' },
    ]);
    expect(result.lane).toBeUndefined();
  });

  it('defaults to 7 days for older releases and uses UTC days for 30 days', async () => {
    const { id } = await release(0);
    await expect(timeseries(id)).resolves.toMatchObject({
      range: '7d',
      from: '2026-09-03T11:00:00.000Z',
      buckets: expect.any(Array),
      markers: [],
    });
    expect((await timeseries(id)).buckets).toHaveLength(168);

    const daily = await timeseries(id, { range: '30d', platform: 'android' });
    expect(daily).toMatchObject({
      granularity: 'day',
      from: '2026-08-12T00:00:00.000Z',
      to: '2026-09-11T00:00:00.000Z',
      platform: 'android',
    });
    expect(daily.buckets).toHaveLength(30);
    expect(readTimeseries).toHaveBeenLastCalledWith(
      expect.objectContaining({ daily: true, platform: 'android' }),
    );
    expect(daily.markers).toEqual([
      { at: '2026-09-01T00:00:00.000Z', type: 'released', label: 'Released' },
    ]);
  });

  it('marks rollout steps and an auto-revert within the range', async () => {
    const { id } = await release(0, {
      promotedAt: at('2026-09-10T01:00:00.000Z'),
      rolloutPercent: 50,
      revertedAt: at('2026-09-10T09:00:00.000Z'),
      revertedBy: 'system:auto-revert',
    });
    await db.auditLog.createMany({
      data: [
        ['2026-09-10T03:00:00.000Z', 10, 50],
        ['2026-09-10T05:00:00.000Z', 50, 100],
        ['2026-09-01T05:00:00.000Z', 1, 10],
      ].map(([createdAt, fromPercent, toPercent]) => ({
        organizationId,
        actorType: 'user',
        actorLabel: 'dev@example.com',
        action: 'release.rollout_updated',
        targetType: 'release',
        targetId: id,
        createdAt: at(String(createdAt)),
        metadata: { fromPercent, toPercent },
      })),
    });

    await expect(timeseries(id, { range: '24h' })).resolves.toMatchObject({
      markers: [
        { at: '2026-09-10T01:00:00.000Z', type: 'released', label: 'Released' },
        { at: '2026-09-10T03:00:00.000Z', type: 'rollout', label: '10% → 50%' },
        { at: '2026-09-10T05:00:00.000Z', type: 'rollout', label: 'Rollout complete' },
        { at: '2026-09-10T09:00:00.000Z', type: 'auto_reverted', label: 'Auto-reverted' },
      ],
    });
  });

  it('labels a manual revert, and a reverted partial rollout as cancelled', async () => {
    const reverted = await release(0, {
      promotedAt: at('2026-09-10T01:00:00.000Z'),
      revertedAt: at('2026-09-10T02:00:00.000Z'),
      revertedBy: 'dev@example.com',
    });
    const cancelled = await release(1, {
      promotedAt: at('2026-09-10T03:00:00.000Z'),
      rolloutPercent: 10,
      revertedAt: at('2026-09-10T04:00:00.000Z'),
      revertedBy: 'dev@example.com',
    });

    expect((await timeseries(reverted.id, { range: '24h' })).markers).toContainEqual({
      at: '2026-09-10T02:00:00.000Z',
      type: 'reverted',
      label: 'Reverted',
    });
    expect((await timeseries(cancelled.id, { range: '24h' })).markers).toContainEqual({
      at: '2026-09-10T04:00:00.000Z',
      type: 'reverted',
      label: 'Rollout cancelled',
    });
    const replaced = await release(2, {
      promotedAt: at('2026-09-10T05:00:00.000Z'),
      rolloutPercent: 20,
      revertedAt: at('2026-09-10T06:00:00.000Z'),
      revertedBy: 'system:rollout-replaced',
    });
    expect((await timeseries(replaced.id, { range: '24h' })).markers).toContainEqual({
      at: '2026-09-10T06:00:00.000Z',
      type: 'reverted',
      label: 'Replaced by a newer rollout',
    });
  });

  it('accepts only real range names', () => {
    expect(['24h', '7d', '30d'].every(isReleaseTimeseriesRange)).toBe(true);
    expect(['toString', 'constructor', '__proto__', '1d'].some(isReleaseTimeseriesRange)).toBe(
      false,
    );
  });

  it('adds the lane: releases of the same channel and runtime live in the range, oldest first', async () => {
    const lane: Array<{ id: string }> = [];
    for (let index = 0; index < 7; index += 1) {
      lane.push(
        await release(index, {
          promotedAt: at(`2026-09-0${index + 1}T00:00:00.000Z`),
          ...(index === 6 ? { promotedAt: at('2026-09-11T00:00:00.000Z') } : {}),
        }),
      );
    }
    await release(7, { promotedAt: at('2026-09-09T00:00:00.000Z') });
    await db.release.create({
      data: {
        appId,
        bundleId: bundleIds[0],
        channel: 'beta',
        promotedAt: at('2026-09-09T00:00:00.000Z'),
      },
    });
    const subject = lane[2];
    readTimeseries.mockResolvedValue({
      available: true,
      data: [
        {
          releaseId: lane[5].id,
          action: 'applied',
          bucketStart: ms('2026-09-10T10:00:00Z'),
          count: 4,
          lastReceivedAt: ms('2026-09-10T10:00:00Z'),
        },
      ],
    });

    const result = await timeseries(subject.id, { lane: true });

    // The 7-day range starts Sep 3, 11:00. The release itself was live then, so
    // lane[0] and lane[1], replaced before it, are left out. lane[6] is promoted
    // after the range, and other channels and runtimes are left out.
    const expected = lane.slice(2, 6);
    expect(result.lane?.releases.map((item) => item.id)).toEqual(expected.map((item) => item.id));
    expect(readTimeseries).toHaveBeenCalledWith(
      expect.objectContaining({ releaseIds: expect.arrayContaining(expected.map((r) => r.id)) }),
    );
    expect(result.lane).toMatchObject({ channel: 'production', runtimeVersion: 'ios-1' });
    const fifth = result.lane?.releases.find((item) => item.id === lane[5].id);
    expect(fifth?.applied).toHaveLength(168);
    expect(fifth?.applied.at(-1)).toBe(4);
    expect(result.lane?.releases[0].applied.every((value) => value === 0)).toBe(true);
    // The lane's counts are not the release's own.
    expect(result.totals.applied).toBe(0);
  });

  it('keeps the releases a revert within the range fell back to', async () => {
    const replacedEarlier = await release(0, { promotedAt: at('2026-08-30T00:00:00.000Z') });
    const liveAtStart = await release(1, { promotedAt: at('2026-09-01T00:00:00.000Z') });
    const revertedInRange = await release(2, {
      promotedAt: at('2026-09-02T00:00:00.000Z'),
      revertedAt: at('2026-09-05T00:00:00.000Z'),
    });
    const revertedBefore = await release(3, {
      promotedAt: at('2026-09-02T12:00:00.000Z'),
      revertedAt: at('2026-09-03T00:00:00.000Z'),
    });
    const subject = await release(4, { promotedAt: at('2026-09-06T00:00:00.000Z') });

    const result = await timeseries(subject.id, { lane: true });

    // From Sep 3, 11:00: the reverted release was live, then devices fell back to
    // the one before it. A release reverted before the range had no applies in it.
    expect(result.lane?.releases.map((item) => item.id)).toEqual([
      liveAtStart.id,
      revertedInRange.id,
      subject.id,
    ]);
    expect(result.lane?.releases.map((item) => item.id)).not.toContain(replacedEarlier.id);
    expect(result.lane?.releases.map((item) => item.id)).not.toContain(revertedBefore.id);
  });

  it('keeps the stable release a rollout shares devices with', async () => {
    const stable = await release(0, { promotedAt: at('2026-09-01T00:00:00.000Z') });
    const rolling = await release(1, {
      promotedAt: at('2026-09-02T00:00:00.000Z'),
      rolloutPercent: 25,
    });

    const result = await timeseries(rolling.id, { lane: true, range: '7d' });

    // The rollout started before the range; most devices still run the stable release.
    expect(result.lane?.releases.map((item) => item.id)).toEqual([stable.id, rolling.id]);
  });

  it('finds an old release’s neighbours on a lane with many newer releases', async () => {
    const hourly: Array<{ id: string }> = [];
    for (let hour = 0; hour < 60; hour += 1) {
      hourly.push(
        await release(hour % 7, {
          promotedAt: new Date(ms('2026-09-01T00:00:00Z') + hour * 3_600_000),
        }),
      );
    }

    const result = await timeseries(hourly[5].id, { lane: true, range: '30d' });

    expect(result.lane?.releases.map((item) => item.id)).toEqual(
      hourly.slice(1, 9).map((item) => item.id),
    );
  });

  it('keeps the releases nearest the viewed one when the lane has more', async () => {
    const daily: Array<{ id: string }> = [];
    for (let day = 0; day < 12; day += 1) {
      daily.push(
        await release(day % 7, {
          promotedAt: new Date(ms('2026-08-20T00:00:00Z') + day * 86_400_000),
        }),
      );
    }

    const early = await timeseries(daily[2].id, { lane: true, range: '30d' });
    expect(early.lane?.releases.map((item) => item.id)).toEqual(
      daily.slice(0, 8).map((item) => item.id),
    );

    // The release it replaced and the ones that replaced it stay in view.
    const late = await timeseries(daily[9].id, { lane: true, range: '30d' });
    expect(late.lane?.releases.map((item) => item.id)).toEqual(
      daily.slice(4, 12).map((item) => item.id),
    );
    const middle = await timeseries(daily[6].id, { lane: true, range: '30d' });
    expect(middle.lane?.releases.map((item) => item.id)).toEqual(
      daily.slice(2, 10).map((item) => item.id),
    );
    expect(readTimeseries).toHaveBeenLastCalledWith(
      expect.objectContaining({ releaseIds: expect.any(Array) }),
    );
    expect(readTimeseries.mock.lastCall?.[0].releaseIds).toHaveLength(8);
  });

  it('reports unavailable analytics without inventing counts', async () => {
    const { id } = await release(0);
    readTimeseries.mockResolvedValue({ data: [], available: false });
    await expect(timeseries(id, { range: '24h' })).resolves.toMatchObject({
      analyticsAvailable: false,
      lastEventAt: null,
      totals: { applied: 0, rollbackSharePercent: null },
    });
  });

  it('only finds releases of the caller’s organization', async () => {
    const { id } = await release(0);
    await expect(
      getReleaseTimeseries(
        { organizationId: randomUUID(), appId, releaseId: id },
        { now: NOW, readTimeseries },
      ),
    ).rejects.toMatchObject({ code: 'RELEASE_NOT_FOUND', status: 404 });
    expect(readTimeseries).not.toHaveBeenCalled();
  });
});
