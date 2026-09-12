import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

import { PrismaClient, type BundleTarget } from '@prisma/client';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  schema: `rn_release_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  access: vi.fn(),
  objects: new Map<string, string>(),
  put: vi.fn(),
  purge: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({
  putTextObject: storage.put,
  getTextObject: async (key: string) => storage.objects.get(key),
  buildPublicObjectUrl: (key: string) => `https://cdn.example/${key}`,
  buildFileObjectKey: (appId: string, hash: string) => `files/${appId}/${hash}`,
  listStorageKeys: async (prefix: string) =>
    [...storage.objects.keys()].filter((key) => key.startsWith(prefix)),
  deleteStorageObject: async (key: string) => {
    storage.objects.delete(key);
  },
}));
vi.mock('@/lib/cdn-purge', () => ({ purgeCdnUrls: storage.purge }));
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn(), accessActor: async () => actor }));
vi.mock('@/lib/organization-access', () => ({ resolveOrganizationAccess: storage.access }));
vi.mock('@/lib/release-audit', () => ({ resolveReleaseActor: async () => actor.actorLabel }));
vi.mock('@/lib/release-features', () => ({ isReleaseReliabilityEnabled: () => false }));
vi.mock('@/lib/db', async () => {
  const { PrismaClient } = await import('@prisma/client');
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/unused');
  url.searchParams.set('schema', storage.schema);
  return { db: new PrismaClient({ datasourceUrl: url.toString() }) };
});

import { db } from '@/lib/db';
import { POST as prepareHTTP } from '@/app/api/v1/apps/[appId]/releases/prepare/route';
import { POST as publishHTTP } from '@/app/api/v1/apps/[appId]/releases/route';
import { GET as prepareRevertHTTP } from '@/app/api/v1/apps/[appId]/releases/[releaseId]/prepare-revert/route';
import { POST as revertHTTP } from '@/app/api/v1/apps/[appId]/releases/[releaseId]/revert/route';

import { computeFilesHash } from '@/lib/delta-files';
import {
  buildManifestStorageKey,
  deleteAllManifestFilesForApp,
  restoreManifestFilesForApp,
  syncManifestFileForLane,
} from '@/lib/manifest-files';
import { buildRNCanonicalPayload } from '@/lib/manifest-signing';
import { createRelease } from '@/lib/releases';
import {
  getReleaseState,
  prepareRelease,
  prepareRevert,
  publishRelease,
  publishReleaseLegacy,
  reconcilePendingReleaseMutations,
  revertRelease,
} from './releases';
import { prepareRNIntent } from './rn-releases';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;
const actor = { actorType: 'key' as const, actorId: 'rn-test-key', actorLabel: 'api-key:rn-test' };
const runtimeVersion = 'A'.repeat(43);
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const run = promisify(execFile);

databaseDescribe('RN publication (PostgreSQL and signed manifests)', () => {
  let admin: PrismaClient;
  let database: PrismaClient;
  let organizationId: string;
  let appId: string;
  const schema = storage.schema;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    admin = new PrismaClient({ datasourceUrl: url.toString() });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('schema', schema);
    await run(
      process.execPath,
      [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        timeout: 60_000,
      },
    );
    database = db;
    vi.stubEnv(
      'MANIFEST_SIGNING_KEY',
      keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    vi.stubEnv('MANIFEST_SIGNING_KID', 'rn-fixture-key');
    vi.stubEnv('MANIFEST_SIGNING_DISABLED', 'false');
  }, 60_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    storage.objects.clear();
    storage.put.mockImplementation(
      async ({ storageKey, body }: { storageKey: string; body: string }) => {
        storage.objects.set(storageKey, body);
      },
    );
    storage.purge.mockResolvedValue(undefined);
    organizationId = randomUUID();
    appId = randomUUID();
    storage.access.mockResolvedValue({
      success: true,
      access: { organizationId, actorType: actor.actorType, actorId: actor.actorId, role: 'owner' },
    });
    await database.organization.create({
      data: {
        id: organizationId,
        name: 'RN release test',
        apps: { create: { id: appId, slug: 'com.example.rn', framework: 'react_native' } },
      },
    });
  });

  afterEach(async () => {
    await database.organization.delete({ where: { id: organizationId } });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await database?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });

  async function artifact(
    version: string,
    platform: BundleTarget = 'ios',
    baselineBundleId?: string,
    strategy = 'zip',
  ) {
    const files = [
      {
        path: 'index.bundle',
        sha256: createHash('sha256').update(`${version}:js`).digest('hex'),
        size: 10,
      },
      {
        path: 'otakit-bundle.json',
        sha256: createHash('sha256').update(`${version}:descriptor`).digest('hex'),
        size: 20,
      },
    ];
    const contentHash = computeFilesHash(files);
    const bundle = await database.bundle.create({
      data: {
        appId,
        platform,
        runtimeVersion,
        version,
        strategy,
        contentHash,
        contentFiles: files,
        sha256:
          strategy === 'deltas'
            ? contentHash
            : createHash('sha256').update(`${version}:zip`).digest('hex'),
        storageKey: `bundles/${appId}/${version}.zip`,
        size: strategy === 'deltas' ? 30 : 100,
        ...(baselineBundleId
          ? { baselineBundleId }
          : {
              embeddedReceipt: {
                appId,
                framework: 'react-native',
                platform,
                runtimeVersion,
                version,
                embeddedContentHash: contentHash,
              },
            }),
      },
    });
    if (strategy === 'deltas') storage.objects.set(bundle.storageKey, JSON.stringify({ files }));
    return bundle;
  }

  async function prepared(bundleId: string, channel: string | null = 'production') {
    const preview = await prepareRelease(
      { organizationId, actor, appId, bundleId, channel },
      { database },
    );
    return {
      organizationId,
      actor,
      appId,
      bundleId,
      channel,
      expectedCurrentReleaseId: preview.expectedCurrentReleaseId,
      rnIntent: preview.rnIntent,
      idempotencyKey: randomUUID(),
    };
  }

  async function revert(releaseId: string) {
    const preview = await prepareRevert({ organizationId, actor, appId, releaseId }, { database });
    return revertRelease(
      {
        organizationId,
        actor,
        appId,
        releaseId,
        rnIntent: preview.rnIntent,
        expectedCurrentReleaseId: preview.expectedCurrentReleaseId,
        idempotencyKey: randomUUID(),
      },
      { database },
    );
  }

  function manifest(platform: BundleTarget = 'ios', channel: string | null = 'production') {
    return JSON.parse(
      storage.objects.get(buildManifestStorageKey(appId, channel, runtimeVersion, platform))!,
    );
  }

  it('atomically initializes baseline history and publishes only the final signed OTA manifest', async () => {
    const baseline = await artifact('baseline');
    const ota = await artifact('ota', 'ios', baseline.id);
    const result = await publishRelease(
      { ...(await prepared(ota.id)), forceImmediate: true, autoRevert: true },
      { database },
    );
    expect(result.publicationStatus).toBe('published');
    expect(result.currentRelease?.id).toBe(result.release.id);
    expect(result.previousRelease).toMatchObject({
      bundleId: baseline.id,
      forceImmediate: false,
      autoRevert: false,
    });
    const history = await database.release.findMany({
      where: { appId },
      orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    });
    expect(history.map((row) => row.bundleId)).toEqual([ota.id, baseline.id]);
    expect(history[0].promotedAt.getTime()).toBeGreaterThan(history[1].promotedAt.getTime());
    await expect(database.releaseMutation.count({ where: { appId } })).resolves.toBe(1);
    expect(storage.put).toHaveBeenCalledOnce();
    const value = manifest();
    expect(value).toMatchObject({
      schemaVersion: 3,
      framework: 'react-native',
      platform: 'ios',
      releaseId: result.release.id,
      contentHash: ota.contentHash,
      forceImmediate: true,
    });
    expect(
      verify(
        'sha256',
        Buffer.from(
          buildRNCanonicalPayload(
            value,
            value.signature.kid,
            value.signature.iat,
            value.signature.exp,
          ),
        ),
        keys.publicKey,
        Buffer.from(value.signature.sig, 'base64url'),
      ),
    ).toBe(true);
    expect(storage.objects.has(buildManifestStorageKey(appId, 'production', runtimeVersion))).toBe(
      false,
    );
  });

  it('leaves Capacitor manifest fields and URLs unchanged through the shared writer', async () => {
    await database.app.update({ where: { id: appId }, data: { framework: 'capacitor' } });
    const bundle = await database.bundle.create({
      data: {
        appId,
        version: '1.0.0',
        runtimeVersion,
        sha256: 'a'.repeat(64),
        size: 100,
        storageKey: 'legacy.zip',
      },
    });
    const result = await publishRelease(await prepared(bundle.id), { database });
    const value = manifest('cross');
    const { signature, ...legacy } = value;
    expect(signature.sig).toBeTypeOf('string');
    expect(legacy).toEqual({
      version: '1.0.0',
      sha256: 'a'.repeat(64),
      size: 100,
      channel: 'production',
      runtimeVersion,
      releaseId: result.release.id,
      strategy: 'zip',
      forceImmediate: false,
      encryption: null,
      url: 'https://cdn.example/legacy.zip',
    });
    expect([...storage.objects.keys()]).toEqual([
      `manifests/${appId}/production/${runtimeVersion}/manifest.json`,
    ]);
  });

  it('keeps encryption parameters and plaintext identity in a signed RN ZIP manifest', async () => {
    const baseline = await artifact('baseline');
    const ota = await artifact('encrypted', 'ios', baseline.id);
    const encryption = {
      alg: 'AES-256-GCM',
      kid: '0123456789abcdef',
      wrapNonce: Buffer.alloc(12, 1).toString('base64'),
      wrappedDek: Buffer.alloc(48, 2).toString('base64'),
      nonce: Buffer.alloc(12, 3).toString('base64'),
    };
    await database.bundle.update({ where: { id: ota.id }, data: { encryption } });
    await publishRelease(await prepared(ota.id), { database });
    const value = manifest();
    expect(value.encryption).toEqual(encryption);
    expect(value.contentHash).toBe(ota.contentHash);
    expect(value.sha256).not.toBe(value.contentHash);
    const payload = buildRNCanonicalPayload(
      value,
      value.signature.kid,
      value.signature.iat,
      value.signature.exp,
    );
    expect(
      verify(
        'sha256',
        Buffer.from(payload),
        keys.publicKey,
        Buffer.from(value.signature.sig, 'base64url'),
      ),
    ).toBe(true);
    expect(
      verify(
        'sha256',
        Buffer.from(payload.replace(encryption.kid, 'another-key')),
        keys.publicKey,
        Buffer.from(value.signature.sig, 'base64url'),
      ),
    ).toBe(false);
  });

  it('rejects future and missing intents before creating a first publication', async () => {
    const baseline = await artifact('baseline');
    const input = await prepared(baseline.id);
    await expect(
      publishRelease(
        {
          ...input,
          rnIntent: { ...input.rnIntent!, preparedAt: new Date(Date.now() + 60_000).toISOString() },
        },
        { database },
      ),
    ).rejects.toMatchObject({ code: 'RN_REPLAY_SCOPE_LOST' });
    await expect(
      publishRelease({ ...input, idempotencyKey: undefined }, { database }),
    ).rejects.toMatchObject({ code: 'RN_INTENT_REQUIRED' });
    await expect(
      publishRelease({ ...input, expectedCurrentReleaseId: undefined }, { database }),
    ).rejects.toMatchObject({ code: 'RN_INTENT_REQUIRED' });
    await expect(database.release.count({ where: { appId } })).resolves.toBe(0);
  });

  it('rolls back baseline creation too when the OTA database write fails', async () => {
    const baseline = await artifact('baseline');
    const ota = await artifact('ota', 'ios', baseline.id);
    let baselineWritten = false;
    const failing = database.$extends({
      query: {
        release: {
          async create({ args, query }) {
            if (args.data.bundleId === ota.id) throw new Error('injected OTA write failure');
            const result = await query(args);
            baselineWritten = true;
            return result;
          },
        },
      },
    }) as unknown as PrismaClient;
    await expect(publishRelease(await prepared(ota.id), { database: failing })).rejects.toThrow(
      'injected OTA write failure',
    );
    expect(baselineWritten).toBe(true);
    await expect(database.release.count({ where: { appId } })).resolves.toBe(0);
    await expect(database.releaseMutation.count({ where: { appId } })).resolves.toBe(0);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('lets only one concurrent first publisher commit the expected-empty lane', async () => {
    const baseline = await artifact('baseline');
    const left = await artifact('left', 'ios', baseline.id);
    const right = await artifact('right', 'ios', baseline.id);
    const inputs = await Promise.all([prepared(left.id), prepared(right.id)]);
    const outcomes = await Promise.allSettled(
      inputs.map((input) => publishRelease(input, { database })),
    );
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'STALE_RELEASE_STATE' },
    });
    await expect(database.release.count({ where: { appId } })).resolves.toBe(2);
    await expect(database.releaseMutation.count({ where: { appId } })).resolves.toBe(1);
  });

  it('preserves established history when another store baseline shares the runtime and orders the next release after it', async () => {
    const original = await artifact('original-baseline');
    const firstOTA = await artifact('first-ota', 'ios', original.id);
    const first = await publishRelease(await prepared(firstOTA.id), { database });
    // Exercise timestamp ordering without changing the host/database clock.
    const future = new Date(Date.now() + 60_000);
    await database.release.update({
      where: { id: first.release.id },
      data: { promotedAt: future },
    });
    const otherBaseline = await artifact('other-store-baseline');
    const nextOTA = await artifact('next-ota', 'ios', otherBaseline.id);
    const next = await publishRelease(await prepared(nextOTA.id), { database });
    expect(next.previousRelease?.id).toBe(first.release.id);
    expect(Date.parse(next.release.promotedAt)).toBeGreaterThan(future.getTime());
    await expect(database.release.count({ where: { appId } })).resolves.toBe(3);
    await expect(database.release.count({ where: { bundleId: otherBaseline.id } })).resolves.toBe(
      0,
    );
    expect((await revert(next.release.id)).currentRelease?.id).toBe(first.release.id);
  });

  it('isolates iOS and Android even with identical runtime strings, including reversion', async () => {
    const ios = await artifact('ios-base');
    const android = await artifact('android-base', 'android');
    const iosOTA = await artifact('ios-update', 'ios', ios.id);
    const androidOTA = await artifact('android-update', 'android', android.id);
    const [left, right] = await Promise.all([prepared(iosOTA.id), prepared(androidOTA.id)]);
    const [iosResult, androidResult] = await Promise.all([
      publishRelease(left, { database }),
      publishRelease(right, { database }),
    ]);
    await expect(
      getReleaseState(
        { organizationId, appId, channel: 'production', runtimeVersion },
        { database },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_LANE' });
    expect(
      (
        await getReleaseState(
          { organizationId, appId, channel: 'production', runtimeVersion, platform: 'android' },
          { database },
        )
      ).currentRelease?.id,
    ).toBe(androidResult.release.id);
    await revert(iosResult.release.id);
    expect(manifest().version).toBe(ios.version);
    expect(manifest('android').releaseId).toBe(androidResult.release.id);
  });

  it('repairs a pending first-publication manifest from current state after the OTA was reverted', async () => {
    const baseline = await artifact('baseline');
    const ota = await artifact('ota', 'ios', baseline.id);
    const input = await prepared(ota.id);
    storage.purge.mockRejectedValueOnce(new Error('purge failed'));
    const pending = await publishRelease(input, { database });
    expect(pending.publicationStatus).toBe('manifest_sync_pending');
    const reverted = await revert(pending.release.id);
    await expect(reconcilePendingReleaseMutations({}, { database })).resolves.toEqual({
      checked: 1,
      repaired: 1,
      pending: 0,
    });
    const replay = await publishRelease(input, { database });
    expect(replay.release.id).toBe(pending.release.id);
    expect(replay.currentRelease?.id).toBe(reverted.currentRelease?.id);
    expect(manifest().version).toBe(baseline.version);
    await expect(database.release.count({ where: { appId } })).resolves.toBe(2);
  });

  it('does not resurrect B after reverting to original A when the retry actor or window is lost', async () => {
    const baseline = await artifact('baseline');
    const a = await publishRelease(await prepared(baseline.id), { database });
    const ota = await artifact('ota', 'ios', baseline.id);
    const input = await prepared(ota.id);
    const b = await publishRelease(input, { database });
    await revert(b.release.id);
    const replay = await publishRelease(input, { database });
    expect(replay.release.id).toBe(b.release.id);
    expect(replay.currentRelease?.id).toBe(a.release.id);
    await expect(
      publishRelease({ ...input, actor: { ...actor, actorId: 'rotated-key' } }, { database }),
    ).rejects.toMatchObject({ code: 'RN_REPLAY_SCOPE_LOST' });
    // Model the retained record/receipt aging past the seven-day retention;
    // no host or database clock changes are needed for this boundary test.
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await database.releaseMutation.update({
      where: { id: b.operationId },
      data: { expiresAt: old },
    });
    await expect(
      publishRelease(
        { ...input, rnIntent: { ...input.rnIntent!, preparedAt: old.toISOString() } },
        { database },
      ),
    ).rejects.toMatchObject({ code: 'RN_REPLAY_SCOPE_LOST' });
    await expect(
      publishRelease({ ...input, rnIntent: undefined }, { database }),
    ).rejects.toMatchObject({ code: 'RN_INTENT_REQUIRED' });
    expect(manifest().releaseId).toBe(a.release.id);
    await expect(database.release.count({ where: { appId } })).resolves.toBe(2);
  });

  it.each(['missing', 'wrong-runtime', 'wrong-receipt', 'both-provenances'])(
    'rejects %s baseline provenance before any release write',
    async (failure) => {
      const baseline = await artifact('baseline');
      const ota = await artifact('ota', 'ios', baseline.id);
      if (failure === 'missing')
        await database.bundle.update({ where: { id: ota.id }, data: { baselineBundleId: null } });
      if (failure === 'wrong-runtime')
        await database.bundle.update({
          where: { id: baseline.id },
          data: { runtimeVersion: 'B'.repeat(42) + 'A' },
        });
      if (failure === 'wrong-receipt')
        await database.bundle.update({
          where: { id: baseline.id },
          data: { embeddedReceipt: { appId: 'other-app' } },
        });
      if (failure === 'both-provenances')
        await database.bundle.update({
          where: { id: ota.id },
          data: { embeddedReceipt: baseline.embeddedReceipt! },
        });
      await expect(
        publishRelease(
          {
            organizationId,
            actor,
            appId,
            bundleId: ota.id,
            channel: 'production',
            rnIntent: await prepareRNIntent(database, actor),
            expectedCurrentReleaseId: null,
            idempotencyKey: randomUUID(),
          },
          { database },
        ),
      ).rejects.toMatchObject({ code: 'RN_BASELINE_REQUIRED' });
      await expect(database.release.count({ where: { appId } })).resolves.toBe(0);
      expect(storage.put).not.toHaveBeenCalled();
    },
  );

  it('protects the final baseline and prevents legacy helper bypasses', async () => {
    const baseline = await artifact('baseline');
    await expect(
      createRelease(database, { appId, bundleId: baseline.id, channel: null }),
    ).rejects.toMatchObject({ code: 'RN_INTENT_REQUIRED' });
    const result = await publishReleaseLegacy(await prepared(baseline.id), { database });
    await expect(revert(result.release.id)).rejects.toMatchObject({ code: 'RN_BASELINE_REQUIRED' });
    await expect(
      revertRelease(
        {
          organizationId,
          actor,
          appId,
          releaseId: result.release.id,
          expectedCurrentReleaseId: result.release.id,
          idempotencyKey: randomUUID(),
          rnIntent: await prepareRNIntent(database, actor),
        },
        { database },
      ),
    ).rejects.toMatchObject({ code: 'RN_BASELINE_REQUIRED' });
    expect(manifest().releaseId).toBe(result.release.id);
    await expect(database.release.count({ where: { appId } })).resolves.toBe(1);
  });

  it('allows only one independently prepared revert to commit during overlapping RN attempts', async () => {
    const baseline = await artifact('baseline');
    const ota = await artifact('ota', 'ios', baseline.id);
    const published = await publishRelease(await prepared(ota.id), { database });
    const previews = await Promise.all(
      [0, 1].map(() =>
        prepareRevert(
          { organizationId, actor, appId, releaseId: published.release.id },
          { database },
        ),
      ),
    );
    const outcomes = await Promise.allSettled(
      previews.map((preview) =>
        revertRelease(
          {
            organizationId,
            actor,
            appId,
            releaseId: published.release.id,
            expectedCurrentReleaseId: preview.expectedCurrentReleaseId,
            rnIntent: preview.rnIntent,
            idempotencyKey: randomUUID(),
          },
          { database },
        ),
      ),
    );
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'STALE_RELEASE_STATE' },
    });
    await expect(
      database.releaseMutation.count({ where: { appId, operation: 'revert' } }),
    ).resolves.toBe(1);
    expect(manifest().version).toBe(baseline.version);
  });

  it('runs HTTP preparation, publication and reversion through the same RN rules with the Capacitor reliability flag off', async () => {
    const baseline = await artifact('baseline');
    const ota = await artifact('http-ota', 'ios', baseline.id);
    const params = Promise.resolve({ appId });
    const request = (body: unknown, key?: string) =>
      new NextRequest('https://console.example/api/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
        body: JSON.stringify(body),
      });
    const previewResponse = await prepareHTTP(
      request({ bundleId: ota.id, channel: 'production' }),
      { params },
    );
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json();
    expect(preview).toMatchObject({
      platform: 'ios',
      baselineBundleId: baseline.id,
      expectedCurrentReleaseId: null,
      rnIntent: { version: 1, actorKey: `key:${actor.actorId}` },
    });
    const missing = await publishHTTP(
      request(
        { bundleId: ota.id, channel: 'production', expectedCurrentReleaseId: null },
        randomUUID(),
      ),
      { params },
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: 'RN_INTENT_REQUIRED' });
    await expect(database.release.count({ where: { appId } })).resolves.toBe(0);
    const response = await publishHTTP(
      request(
        {
          bundleId: ota.id,
          channel: 'production',
          expectedCurrentReleaseId: preview.expectedCurrentReleaseId,
          rnIntent: preview.rnIntent,
        },
        randomUUID(),
      ),
      { params },
    );
    expect(response.status).toBe(200);
    const published = await response.json();
    expect(published.previousRelease.bundleId).toBe(baseline.id);
    const revertParams = Promise.resolve({ appId, releaseId: published.release.id });
    const revertPreviewResponse = await prepareRevertHTTP(
      new NextRequest('https://console.example/api/revert'),
      { params: revertParams },
    );
    expect(revertPreviewResponse.status).toBe(200);
    const revertPreview = await revertPreviewResponse.json();
    const revertedResponse = await revertHTTP(
      request(
        {
          expectedCurrentReleaseId: revertPreview.expectedCurrentReleaseId,
          rnIntent: revertPreview.rnIntent,
        },
        randomUUID(),
      ),
      { params: revertParams },
    );
    expect(revertedResponse.status).toBe(200);
    expect((await revertedResponse.json()).currentRelease.bundleId).toBe(baseline.id);
    expect(manifest().version).toBe(baseline.version);
    await expect(database.release.count({ where: { appId } })).resolves.toBe(2);
  });

  it('publishes verified delta inventory and refuses a changed storage list', async () => {
    const baseline = await artifact('baseline');
    const ota = await artifact('delta', 'ios', baseline.id, 'deltas');
    await publishRelease(await prepared(ota.id), { database });
    expect(manifest()).toMatchObject({
      strategy: 'deltas',
      contentHash: ota.contentHash,
      sha256: ota.contentHash,
      filesHash: ota.contentHash,
    });
    expect(manifest().files).toHaveLength(2);
    storage.objects.set(ota.storageKey, JSON.stringify({ files: [] }));
    storage.put.mockClear();
    await expect(
      syncManifestFileForLane(appId, 'production', runtimeVersion, database, 'ios'),
    ).rejects.toThrow('delta list differs');
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('restores the correct RN namespaces and removes all app-prefixed manifests on cleanup', async () => {
    const baseline = await artifact('baseline');
    await publishRelease(await prepared(baseline.id), { database });
    storage.objects.set(buildManifestStorageKey(appId, null, null), 'stale legacy object');
    storage.objects.set('manifests/other-app/keep.json', 'keep');
    await deleteAllManifestFilesForApp(appId);
    expect([...storage.objects.keys()]).toEqual(['manifests/other-app/keep.json']);
    await restoreManifestFilesForApp(appId, database);
    expect(manifest().framework).toBe('react-native');
    expect(storage.objects.has(buildManifestStorageKey(appId, null, null))).toBe(false);
    await database.organization.update({
      where: { id: organizationId },
      data: { usageBlocked: true },
    });
    await syncManifestFileForLane(appId, 'production', runtimeVersion, database, 'ios');
    expect([...storage.objects.keys()]).toEqual(['manifests/other-app/keep.json']);
  });
});
