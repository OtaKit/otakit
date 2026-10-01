import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import { syncManifestFileForLane } from '@/lib/manifest-files';
import { putTextObject } from '@/lib/storage';

import {
  prepareRelease,
  prepareRevert,
  publishRelease,
  publishReleaseLegacy,
  reconcilePendingReleaseMutations,
  revertRelease,
  updateReleaseNotes,
  updateRollout,
} from './releases';

vi.mock('@/lib/storage', () => ({
  buildFileObjectKey: (appId: string, sha256: string) => `files/${appId}/${sha256}`,
  buildPublicObjectUrl: (key: string) => `https://cdn.test/${key}`,
  deleteStorageObject: vi.fn(),
  getTextObject: vi.fn(),
  listStorageKeys: vi.fn(),
  putTextObject: vi.fn(),
}));
vi.mock('@/lib/cdn-purge', () => ({ purgeCdnUrls: vi.fn() }));
vi.stubEnv('MANIFEST_SIGNING_DISABLED', 'true');

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

  describe('release notes', () => {
    const publish = (bundleId: string, notes: string | null, idempotencyKey = randomUUID()) =>
      publishRelease(
        { organizationId, actor, appId, bundleId, channel: 'production', notes, idempotencyKey },
        { syncManifest: vi.fn().mockResolvedValue(undefined) },
      );

    it('normalises notes, shows them in prepare, and replays only the same notes', async () => {
      const raw = '  Faster checkout.\r\nPhoto upload fixed.\n ';
      const prepared = await prepareRelease({
        organizationId,
        appId,
        bundleId: bundleIds[0],
        channel: 'production',
        notes: raw,
      });
      expect(prepared.notes).toBe('Faster checkout.\nPhoto upload fixed.');

      const idempotencyKey = randomUUID();
      const first = await publish(bundleIds[0], raw, idempotencyKey);
      expect(first.release.notes).toBe('Faster checkout.\nPhoto upload fixed.');
      await expect(publish(bundleIds[0], raw, idempotencyKey)).resolves.toEqual(first);
      await expect(publish(bundleIds[0], 'Other notes', idempotencyKey)).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
      await expect(
        db.auditLog.findFirstOrThrow({ where: { organizationId, action: 'release.created' } }),
      ).resolves.toMatchObject({ metadata: expect.objectContaining({ hasNotes: true }) });
    });

    it('rejects notes that are too long or not text, and stores empty notes as none', async () => {
      await expect(publish(bundleIds[0], 'x'.repeat(2001))).rejects.toMatchObject({
        code: 'INVALID_INPUT',
        status: 400,
      });
      await expect(publish(bundleIds[0], 42 as unknown as string)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });
      await expect(publish(bundleIds[0], '  \n ')).resolves.toMatchObject({
        release: { notes: null },
      });
    });

    it('puts the notes into the lane manifest devices download', async () => {
      const write = vi.mocked(putTextObject);
      write.mockClear();
      await publishRelease({
        organizationId,
        actor,
        appId,
        bundleId: bundleIds[0],
        channel: 'production',
        notes: 'Faster checkout.',
        idempotencyKey: randomUUID(),
      });
      const manifest = JSON.parse((write.mock.calls.at(-1)![0] as { body: string }).body);
      expect(manifest.notes).toEqual({ text: 'Faster checkout.', signature: null });
    });

    it('edits notes, audits once, and republishes only the lane of a live release', async () => {
      const { release } = await publish(bundleIds[0], 'First draft');
      const syncManifest = vi.fn().mockResolvedValue(undefined);
      const edit = (notes: string | null) =>
        updateReleaseNotes(
          { organizationId, actor, appId, releaseId: release.id, notes },
          { syncManifest },
        );

      await expect(edit('Faster checkout.')).resolves.toMatchObject({
        release: { id: release.id, notes: 'Faster checkout.' },
      });
      expect(syncManifest).toHaveBeenCalledWith(
        appId,
        'production',
        'ios-1',
        expect.objectContaining({ release: expect.any(Object) }),
      );
      // The same text again changes nothing but republishes (a retry after a failure).
      await edit('Faster checkout.');
      expect(syncManifest).toHaveBeenCalledTimes(2);
      await expect(
        db.auditLog.count({ where: { organizationId, action: 'release.notes_updated' } }),
      ).resolves.toBe(1);
      await expect(edit(null)).resolves.toMatchObject({ release: { notes: null } });
    });

    it('keeps the edit and its audit entry when republishing fails, and repairs on retry', async () => {
      const { release } = await publish(bundleIds[0], null);
      const failing = vi.fn().mockRejectedValue(new Error('storage unavailable'));
      const input = { organizationId, actor, appId, releaseId: release.id, notes: 'New notes' };

      await expect(updateReleaseNotes(input, { syncManifest: failing })).rejects.toThrow(
        'storage unavailable',
      );
      await expect(
        db.release.findUniqueOrThrow({ where: { id: release.id } }),
      ).resolves.toMatchObject({ notes: 'New notes' });
      const repair = vi.fn().mockResolvedValue(undefined);
      await updateReleaseNotes(input, { syncManifest: repair });
      expect(repair).toHaveBeenCalledTimes(1);
      await expect(
        db.auditLog.count({ where: { organizationId, action: 'release.notes_updated' } }),
      ).resolves.toBe(1);
    });

    it('edits a reverted release without republishing, and hides other workspaces', async () => {
      const { release } = await publish(bundleIds[0], 'Old');
      await db.release.update({ where: { id: release.id }, data: { revertedAt: new Date() } });
      const syncManifest = vi.fn().mockResolvedValue(undefined);

      await updateReleaseNotes(
        { organizationId, actor, appId, releaseId: release.id, notes: 'Corrected' },
        { syncManifest },
      );
      expect(syncManifest).not.toHaveBeenCalled();
      await expect(
        updateReleaseNotes(
          { organizationId: randomUUID(), actor, appId, releaseId: release.id, notes: 'x' },
          { syncManifest },
        ),
      ).rejects.toMatchObject({ code: 'RELEASE_NOT_FOUND', status: 404 });
    });

    it('stores notes on the legacy publish path too', async () => {
      const result = await publishReleaseLegacy(
        {
          organizationId,
          actor,
          appId,
          bundleId: bundleIds[0],
          channel: 'production',
          notes: 'Legacy notes',
        },
        { syncManifest: vi.fn().mockResolvedValue(undefined) },
      );
      expect(result.release.notes).toBe('Legacy notes');
    });
  });

  describe('percentage rollouts', () => {
    const syncManifest = vi.fn().mockResolvedValue(undefined);

    async function publish(bundleIndex: number, options: Record<string, unknown> = {}) {
      return publishRelease(
        {
          organizationId,
          actor,
          appId,
          bundleId: bundleIds[bundleIndex],
          channel: 'production',
          idempotencyKey: randomUUID(),
          ...options,
        },
        { syncManifest },
      );
    }

    async function setPercent(releaseId: string, percent: number, expectedPercent?: number) {
      return updateRollout(
        {
          organizationId,
          actor,
          appId,
          releaseId,
          percent,
          expectedPercent,
          idempotencyKey: randomUUID(),
        },
        { syncManifest },
      );
    }

    beforeEach(() => {
      syncManifest.mockClear();
    });

    it('starts a rollout on top of the stable release, changes it, and completes it', async () => {
      const stable = await publish(0);
      const rolling = await publish(1, { rolloutPercent: 10 });

      expect(rolling.release).toMatchObject({ rolloutPercent: 10, previousBundleId: bundleIds[0] });
      expect(rolling.previousRelease?.id).toBe(stable.release.id);

      const raised = await setPercent(rolling.release.id, 25, 10);
      expect(raised).toMatchObject({
        publicationStatus: 'published',
        previousPercent: 10,
        release: { id: rolling.release.id, rolloutPercent: 25 },
      });
      const lowered = await setPercent(rolling.release.id, 5, 25);
      expect(lowered.release.rolloutPercent).toBe(5);
      const completed = await setPercent(rolling.release.id, 100, 5);
      expect(completed.release.rolloutPercent).toBe(100);
      expect(syncManifest).toHaveBeenCalledTimes(5);
      expect(syncManifest).toHaveBeenLastCalledWith(
        appId,
        'production',
        'ios-1',
        expect.anything(),
      );

      await expect(setPercent(rolling.release.id, 50)).rejects.toMatchObject({
        code: 'ROLLOUT_NOT_ACTIVE',
        status: 409,
      });
      const audit = await db.auditLog.findMany({
        where: { organizationId, action: 'release.rollout_updated' },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((entry) => entry.metadata)).toEqual([
        expect.objectContaining({ fromPercent: 10, toPercent: 25, bundleVersion: '1.0.1' }),
        expect.objectContaining({ fromPercent: 25, toPercent: 5 }),
        expect.objectContaining({ fromPercent: 5, toPercent: 100 }),
      ]);
      await expect(
        db.auditLog.findFirstOrThrow({
          where: { organizationId, action: 'release.created', targetId: rolling.release.id },
        }),
      ).resolves.toMatchObject({ metadata: expect.objectContaining({ rolloutPercent: 10 }) });
    });

    it('sends the first release on a lane to every device', async () => {
      await expect(publish(0, { rolloutPercent: 50 })).rejects.toMatchObject({
        code: 'ROLLOUT_NEEDS_STABLE',
        status: 409,
      });
      await expect(db.release.count({ where: { appId } })).resolves.toBe(0);
    });

    it('blocks a publish during a rollout unless it replaces the rollout', async () => {
      const stable = await publish(0);
      const rolling = await publish(1, { rolloutPercent: 10 });

      await expect(publish(2)).rejects.toMatchObject({ code: 'ROLLOUT_IN_PROGRESS', status: 409 });
      await expect(publish(0, { replaceRollout: true })).rejects.toMatchObject({
        code: 'STALE_RELEASE_STATE',
      });

      const replacement = await publish(2, { replaceRollout: true, rolloutPercent: 20 });
      expect(replacement.release).toMatchObject({
        rolloutPercent: 20,
        previousBundleId: bundleIds[0],
      });
      expect(replacement.previousRelease?.id).toBe(stable.release.id);
      expect(replacement.replacedRelease).toMatchObject({
        id: rolling.release.id,
        revertedBy: 'system:rollout-replaced',
      });
      await expect(
        db.release.findUniqueOrThrow({ where: { id: rolling.release.id } }),
      ).resolves.toMatchObject({ revertedBy: 'system:rollout-replaced' });
      await expect(
        db.auditLog.findFirstOrThrow({
          where: { organizationId, action: 'release.created', targetId: replacement.release.id },
        }),
      ).resolves.toMatchObject({
        metadata: expect.objectContaining({ replacedReleaseId: rolling.release.id }),
      });
    });

    it('rejects stale and unchanged percentages and replays retries', async () => {
      await publish(0);
      const rolling = await publish(1, { rolloutPercent: 10 });

      await expect(setPercent(rolling.release.id, 50, 25)).rejects.toMatchObject({
        code: 'STALE_RELEASE_STATE',
      });
      await expect(setPercent(rolling.release.id, 10)).rejects.toMatchObject({
        code: 'ROLLOUT_UNCHANGED',
        status: 409,
      });
      await expect(setPercent(rolling.release.id, 0)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      });

      const input = {
        organizationId,
        actor,
        appId,
        releaseId: rolling.release.id,
        percent: 50,
        expectedPercent: 10,
        idempotencyKey: randomUUID(),
      };
      const first = await updateRollout(input, { syncManifest });
      const replay = await updateRollout(input, { syncManifest });
      expect(replay).toEqual(first);
      await expect(
        updateRollout({ ...input, percent: 60 }, { syncManifest }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      await expect(
        db.auditLog.count({ where: { organizationId, action: 'release.rollout_updated' } }),
      ).resolves.toBe(1);
    });

    it('decides concurrent rollout changes on the state read under the lane lock', async () => {
      await publish(0);
      const rolling = await publish(1, { rolloutPercent: 10 });

      const outcomes = await Promise.allSettled([
        setPercent(rolling.release.id, 100, 10),
        setPercent(rolling.release.id, 25, 10),
      ]);

      // Both reviewed 10%; only one change may apply, and a completed rollout
      // must never be reopened by the other.
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
        reason: expect.objectContaining({
          code: expect.stringMatching(/^(ROLLOUT_NOT_ACTIVE|STALE_RELEASE_STATE)$/),
        }),
      });
      const stored = await db.release.findUniqueOrThrow({ where: { id: rolling.release.id } });
      const applied = outcomes.find((outcome) => outcome.status === 'fulfilled') as
        | PromiseFulfilledResult<Awaited<ReturnType<typeof setPercent>>>
        | undefined;
      expect(stored.rolloutPercent).toBe(applied?.value.release.rolloutPercent);
      await expect(
        db.auditLog.count({ where: { organizationId, action: 'release.rollout_updated' } }),
      ).resolves.toBe(1);
    });

    it('refuses to cancel a rollout that completed or changed after it was reviewed', async () => {
      await publish(0);
      const rolling = await publish(1, { rolloutPercent: 10 });
      await setPercent(rolling.release.id, 100, 10);

      await expect(
        revertRelease(
          {
            organizationId,
            actor,
            appId,
            releaseId: rolling.release.id,
            expectedCurrentReleaseId: rolling.release.id,
            expectedRolloutPercent: 10,
            idempotencyKey: randomUUID(),
          },
          { syncManifest },
        ),
      ).rejects.toMatchObject({ code: 'STALE_RELEASE_STATE' });
      await expect(
        db.release.findUniqueOrThrow({ where: { id: rolling.release.id } }),
      ).resolves.toMatchObject({ revertedAt: null, rolloutPercent: 100 });
    });

    it('checks native compatibility against the stable release during a rollout', async () => {
      const nativeSet = (checksum: string) => [
        { name: '@capacitor/core', version: '7.0.0', iosChecksum: checksum },
      ];
      await db.bundle.update({
        where: { id: bundleIds[0] },
        data: { nativePackages: nativeSet('store-build') },
      });
      await db.bundle.update({
        where: { id: bundleIds[1] },
        data: { nativePackages: nativeSet('changed') },
      });
      await db.bundle.update({
        where: { id: bundleIds[2] },
        data: { nativePackages: nativeSet('changed') },
      });
      await publish(0);
      await publish(1, {
        rolloutPercent: 10,
        enforceCompatibility: true,
        compatibilityDecision: 'proceed',
      });

      // Same native set as the rolling release, but not as the stable one the
      // other 90% of devices run and this release would fall back to.
      const preview = await prepareRelease({
        organizationId,
        appId,
        bundleId: bundleIds[2],
        channel: 'production',
      });
      expect(preview.compatibility.status).toBe('incompatible');
      await expect(
        publish(2, { replaceRollout: true, enforceCompatibility: true }),
      ).rejects.toMatchObject({ code: 'INCOMPATIBLE_NATIVE_CHANGE' });
    });

    it('cancels a rollout by reverting it, which returns the lane to stable', async () => {
      const stable = await publish(0);
      const rolling = await publish(1, { rolloutPercent: 10 });

      const preview = await prepareRevert({ organizationId, appId, releaseId: rolling.release.id });
      expect(preview.resultingRelease?.id).toBe(stable.release.id);
      const cancelled = await revertRelease(
        {
          organizationId,
          actor,
          appId,
          releaseId: rolling.release.id,
          expectedCurrentReleaseId: rolling.release.id,
          idempotencyKey: randomUUID(),
        },
        { syncManifest },
      );
      expect(cancelled.currentRelease?.id).toBe(stable.release.id);
      await expect(setPercent(rolling.release.id, 50)).rejects.toMatchObject({
        code: 'ROLLOUT_NOT_ACTIVE',
      });
      const next = await publish(2);
      expect(next.release.previousBundleId).toBe(bundleIds[0]);
    });

    it('keeps the legacy publish path at 100% and off rolling lanes', async () => {
      await expect(
        publishReleaseLegacy(
          {
            organizationId,
            actor,
            appId,
            bundleId: bundleIds[0],
            channel: 'production',
            rolloutPercent: 10,
          },
          { syncManifest },
        ),
      ).rejects.toMatchObject({ code: 'ROLLOUTS_UNAVAILABLE' });

      // replaceRollout on its own is harmless on a lane without a rollout.
      await expect(
        publishReleaseLegacy(
          {
            organizationId,
            actor,
            appId,
            bundleId: bundleIds[0],
            channel: 'legacy-lane',
            replaceRollout: true,
          },
          { syncManifest },
        ),
      ).resolves.toMatchObject({ publicationStatus: 'published' });

      await publish(0);
      await publish(1, { rolloutPercent: 10 });
      await expect(
        publishReleaseLegacy(
          { organizationId, actor, appId, bundleId: bundleIds[2], channel: 'production' },
          { syncManifest },
        ),
      ).rejects.toMatchObject({ code: 'ROLLOUT_IN_PROGRESS' });
    });

    it('writes the stable and rolling releases into the lane manifest', async () => {
      await publish(0);
      await publish(1, { rolloutPercent: 10 });
      const { putTextObject } = await import('@/lib/storage');
      vi.mocked(putTextObject).mockClear();

      await syncManifestFileForLane(appId, 'production', 'ios-1');

      const manifest = JSON.parse(vi.mocked(putTextObject).mock.calls[0][0].body);
      expect(manifest).toMatchObject({
        version: '1.0.0',
        releaseId: expect.any(String),
        rollout: { version: '1.0.1', percent: 10, stableSha256: '0'.padStart(64, '0') },
      });
    });
  });
});
