import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';

import {
  prepareRelease,
  prepareRevert,
  publishRelease,
  reconcilePendingReleaseMutations,
  revertRelease,
} from './releases';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

const actor = {
  actorType: 'user' as const,
  actorId: 'release-test-user',
  actorLabel: 'release-test@example.com',
};

databaseDescribe('release reliability (PostgreSQL integration)', () => {
  let organizationId: string;
  let appId: string;
  let bundleIds: string[];

  beforeEach(async () => {
    organizationId = randomUUID();
    appId = randomUUID();
    bundleIds = [randomUUID(), randomUUID(), randomUUID()];

    await db.organization.create({
      data: {
        id: organizationId,
        name: `Release integration ${organizationId}`,
        apps: {
          create: {
            id: appId,
            slug: `integration.${organizationId}`,
            bundles: {
              create: bundleIds.map((id, index) => ({
                id,
                version: `1.0.${index}`,
                sha256: String(index).padStart(64, '0'),
                storageKey: `integration/${organizationId}/${index}.zip`,
                size: 100 + index,
                runtimeVersion: 'ios-1',
                nativePackages: [{ name: '@capacitor/core', version: '7.0.0' }],
              })),
            },
          },
        },
      },
    });
  });

  afterEach(async () => {
    await db.organization.delete({ where: { id: organizationId } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('publishes once, preserves all release options, and replays the stored result', async () => {
    const syncManifest = vi.fn().mockResolvedValue(undefined);
    const prepared = await prepareRelease({
      organizationId,
      appId,
      bundleId: bundleIds[0],
      channel: 'staging',
    });

    expect(prepared.expectedCurrentReleaseId).toBeNull();
    const input = {
      organizationId,
      actor,
      appId,
      bundleId: bundleIds[0],
      channel: 'staging',
      forceImmediate: true,
      autoRevert: true,
      autoRevertRatePercent: 31,
      autoRevertMinSample: 77,
      expectedCurrentReleaseId: prepared.expectedCurrentReleaseId,
      idempotencyKey: randomUUID(),
    };

    const first = await publishRelease(input, { syncManifest });
    const replay = await publishRelease(input, { syncManifest });

    expect(first.publicationStatus).toBe('published');
    expect(replay).toEqual(first);
    expect(first.release).toMatchObject({
      forceImmediate: true,
      autoRevert: true,
      autoRevertRatePercent: 31,
      autoRevertMinSample: 77,
    });
    expect(syncManifest).toHaveBeenCalledTimes(1);
    expect(syncManifest).toHaveBeenCalledWith(
      appId,
      'staging',
      'ios-1',
      expect.objectContaining({ app: expect.any(Object), release: expect.any(Object) }),
    );
    await expect(db.release.count({ where: { appId } })).resolves.toBe(1);
    await expect(
      db.releaseMutation.count({ where: { organizationId, status: 'published' } }),
    ).resolves.toBe(1);
  });

  it('rejects an idempotency key reused with different arguments', async () => {
    const idempotencyKey = randomUUID();
    const syncManifest = vi.fn().mockResolvedValue(undefined);
    await publishRelease(
      {
        organizationId,
        actor,
        appId,
        bundleId: bundleIds[0],
        channel: null,
        expectedCurrentReleaseId: null,
        idempotencyKey,
      },
      { syncManifest },
    );

    await expect(
      publishRelease(
        {
          organizationId,
          actor,
          appId,
          bundleId: bundleIds[1],
          channel: null,
          idempotencyKey,
        },
        { syncManifest },
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });
    await expect(db.release.count({ where: { appId } })).resolves.toBe(1);
  });

  it('rechecks native compatibility for agent publishes and requires an explicit proceed decision', async () => {
    const syncManifest = vi.fn().mockResolvedValue(undefined);
    const baseline = await publishRelease(
      {
        organizationId,
        actor,
        appId,
        bundleId: bundleIds[0],
        channel: null,
        expectedCurrentReleaseId: null,
        idempotencyKey: randomUUID(),
      },
      { syncManifest },
    );
    await db.bundle.update({
      where: { id: bundleIds[0] },
      data: {
        nativePackages: [{ name: '@capacitor/core', version: '7.0.0', iosChecksum: 'baseline' }],
      },
    });
    await db.bundle.update({
      where: { id: bundleIds[1] },
      data: {
        nativePackages: [{ name: '@capacitor/core', version: '7.0.0', iosChecksum: 'changed' }],
      },
    });

    const prepared = await prepareRelease({
      organizationId,
      appId,
      bundleId: bundleIds[1],
      channel: null,
      compatibilityDecision: 'block',
    });
    expect(prepared.compatibility.status).toBe('incompatible');

    const common = {
      organizationId,
      actor,
      appId,
      bundleId: bundleIds[1],
      channel: null,
      expectedCurrentReleaseId: baseline.release.id,
      enforceCompatibility: true,
    };
    await expect(
      publishRelease(
        { ...common, compatibilityDecision: 'block' as const, idempotencyKey: randomUUID() },
        { syncManifest },
      ),
    ).rejects.toMatchObject({ code: 'INCOMPATIBLE_NATIVE_CHANGE', status: 409 });

    const proceeded = await publishRelease(
      { ...common, compatibilityDecision: 'proceed', idempotencyKey: randomUUID() },
      { syncManifest },
    );
    expect(proceeded.compatibility?.status).toBe('incompatible');
    expect(proceeded.publicationStatus).toBe('published');
  });

  it('reports manifest sync as pending and repairs the same release on retry', async () => {
    const idempotencyKey = randomUUID();
    const syncManifest = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('object storage unavailable'))
      .mockResolvedValueOnce(undefined);
    const input = {
      organizationId,
      actor,
      appId,
      bundleId: bundleIds[0],
      channel: null,
      expectedCurrentReleaseId: null,
      idempotencyKey,
    };

    const pending = await publishRelease(input, { syncManifest });
    expect(pending.publicationStatus).toBe('manifest_sync_pending');
    await expect(db.release.count({ where: { appId } })).resolves.toBe(1);
    await expect(
      db.releaseMutation.findFirstOrThrow({ where: { organizationId } }),
    ).resolves.toMatchObject({
      status: 'database_committed',
      errorMessage: 'object storage unavailable',
    });

    const repaired = await publishRelease(input, { syncManifest });
    expect(repaired.publicationStatus).toBe('published');
    expect(repaired.release.id).toBe(pending.release.id);
    await expect(db.release.count({ where: { appId } })).resolves.toBe(1);
    expect(syncManifest).toHaveBeenCalledTimes(2);
  });

  it('serializes a lane so only one publish can use reviewed state', async () => {
    const syncManifest = vi.fn().mockResolvedValue(undefined);
    const first = await publishRelease(
      {
        organizationId,
        actor,
        appId,
        bundleId: bundleIds[0],
        channel: 'production',
        expectedCurrentReleaseId: null,
        idempotencyKey: randomUUID(),
      },
      { syncManifest },
    );

    const common = {
      organizationId,
      actor,
      appId,
      channel: 'production',
      expectedCurrentReleaseId: first.release.id,
    };
    const outcomes = await Promise.allSettled([
      publishRelease(
        { ...common, bundleId: bundleIds[1], idempotencyKey: randomUUID() },
        { syncManifest },
      ),
      publishRelease(
        { ...common, bundleId: bundleIds[2], idempotencyKey: randomUUID() },
        { syncManifest },
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejection).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'STALE_RELEASE_STATE' }),
    });
    await expect(db.release.count({ where: { appId } })).resolves.toBe(2);
  });

  it('previews and idempotently reverts the current release, including manifest repair', async () => {
    const successfulSync = vi.fn().mockResolvedValue(undefined);
    const first = await publishRelease(
      {
        organizationId,
        actor,
        appId,
        bundleId: bundleIds[0],
        channel: null,
        expectedCurrentReleaseId: null,
        idempotencyKey: randomUUID(),
      },
      { syncManifest: successfulSync },
    );
    const second = await publishRelease(
      {
        organizationId,
        actor,
        appId,
        bundleId: bundleIds[1],
        channel: null,
        expectedCurrentReleaseId: first.release.id,
        idempotencyKey: randomUUID(),
      },
      { syncManifest: successfulSync },
    );
    const preview = await prepareRevert({
      organizationId,
      appId,
      releaseId: second.release.id,
    });
    expect(preview.resultingRelease?.id).toBe(first.release.id);

    const idempotencyKey = randomUUID();
    const repairSync = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('CDN purge failed'))
      .mockResolvedValueOnce(undefined);
    const input = {
      organizationId,
      actor,
      appId,
      releaseId: second.release.id,
      forceImmediate: true,
      expectedCurrentReleaseId: preview.expectedCurrentReleaseId,
      idempotencyKey,
      autoRevertAlertPayload: {
        appId,
        channel: null,
        runtimeVersion: 'ios-1',
        bundleVersion: '1.0.1',
        rollbacks: 12,
        attempts: 20,
        measuredRatePercent: 60,
        ratePercent: 20,
        minSample: 10,
        windowHours: 24,
      },
    };

    const pending = await revertRelease(input, { syncManifest: repairSync });
    expect(pending.publicationStatus).toBe('manifest_sync_pending');
    expect(pending.currentRelease).toMatchObject({ id: first.release.id, forceImmediate: true });
    const repaired = await revertRelease(input, { syncManifest: repairSync });
    expect(repaired).toMatchObject({
      publicationStatus: 'published',
      operationId: pending.operationId,
      release: { id: second.release.id },
      currentRelease: { id: first.release.id },
    });
    await expect(
      db.release.findUniqueOrThrow({ where: { id: second.release.id } }),
    ).resolves.toMatchObject({
      revertedBy: actor.actorLabel,
      autoRevertAlertPayload: expect.objectContaining({ rollbacks: 12, attempts: 20 }),
      autoRevertAlertedAt: null,
    });
  });

  it('reconciles a pending manifest without creating another release', async () => {
    const failingSync = vi.fn().mockRejectedValue(new Error('temporary failure'));
    const pending = await publishRelease(
      {
        organizationId,
        actor,
        appId,
        bundleId: bundleIds[0],
        channel: null,
        expectedCurrentReleaseId: null,
        idempotencyKey: randomUUID(),
      },
      { syncManifest: failingSync },
    );
    expect(pending.publicationStatus).toBe('manifest_sync_pending');

    const stats = await reconcilePendingReleaseMutations(
      { limit: 10 },
      { syncManifest: vi.fn().mockResolvedValue(undefined) },
    );
    expect(stats).toMatchObject({ repaired: 1, pending: 0 });
    await expect(db.release.count({ where: { appId } })).resolves.toBe(1);
    await expect(
      db.releaseMutation.findUniqueOrThrow({ where: { id: pending.operationId } }),
    ).resolves.toMatchObject({ status: 'published', errorMessage: null });
  });
});
