import crypto from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  putTextObject: vi.fn(),
  getTextObject: vi.fn(),
  listStorageKeys: vi.fn(),
}));
const database = vi.hoisted(() => ({
  app: { findUnique: vi.fn() },
  release: { findMany: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db: database }));
vi.mock('@/lib/cdn-purge', () => ({ purgeCdnUrls: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  buildFileObjectKey: (appId: string, sha256: string) => `files/${appId}/${sha256}`,
  buildPublicObjectUrl: (key: string) => `https://cdn.test/${key}`,
  deleteStorageObject: vi.fn(),
  getTextObject: storage.getTextObject,
  listStorageKeys: storage.listStorageKeys,
  putTextObject: storage.putTextObject,
}));

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
vi.stubEnv('MANIFEST_SIGNING_DISABLED', '');
vi.stubEnv('MANIFEST_SIGNING_KID', 'test-kid');
vi.stubEnv('MANIFEST_SIGNING_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);

const { resolveLaneManifest, restoreManifestFilesForApp, writeManifestFile } =
  await import('./manifest-files');
const { buildCanonicalPayload, buildRolloutPayload } = await import('./manifest-signing');

type Signature = { kid: string; sig: string; iat: number; exp: number };

function release(id: string, rolloutPercent: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    forceImmediate: false,
    rolloutPercent,
    bundle: {
      version: `1.0.${id}`,
      sha256: id.repeat(64).slice(0, 64),
      size: 100,
      runtimeVersion: 'rt-1',
      strategy: 'zip',
      storageKey: `bundles/${id}.zip`,
      encryption: null,
      ...overrides,
    },
  };
}

function writtenManifest(): Record<string, unknown> & {
  signature: Signature;
  rollout?: Record<string, unknown> & { signature: Signature };
} {
  expect(storage.putTextObject).toHaveBeenCalledTimes(1);
  const [{ storageKey, body }] = storage.putTextObject.mock.calls[0] as [
    { storageKey: string; body: string },
  ];
  expect(storageKey).toBe('manifests/app-1/production/rt-1/manifest.json');
  return JSON.parse(body);
}

function verifies(payload: string, signature: Signature): boolean {
  return crypto.verify(
    'sha256',
    Buffer.from(payload, 'utf-8'),
    publicKey,
    Buffer.from(signature.sig, 'base64url'),
  );
}

describe('resolveLaneManifest', () => {
  it('publishes the current release alone unless it is rolling', () => {
    expect(resolveLaneManifest([])).toBeNull();
    const [a, b] = [release('a', 100), release('b', 100)];
    expect(resolveLaneManifest([a, b])).toEqual({ stable: a, rolling: null });
  });

  it('keeps the release below a rolling release as the stable one', () => {
    const [rolling, stable] = [release('r', 10), release('s', 100)];
    expect(resolveLaneManifest([rolling, stable])).toEqual({ stable, rolling });
  });

  it('refuses to publish a rolling release that has no stable release below it', () => {
    expect(() => resolveLaneManifest([release('r', 10)])).toThrow(/without a stable release/);
  });
});

describe('writeManifestFile', () => {
  beforeEach(() => {
    storage.putTextObject.mockReset();
    storage.getTextObject.mockReset();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('writes an unchanged v2 manifest when nothing is rolling out', async () => {
    const stable = release('s', 100);
    await writeManifestFile('app-1', 'production', 'rt-1', { stable, rolling: null });

    const manifest = writtenManifest();
    expect(manifest).toEqual({
      version: '1.0.s',
      sha256: stable.bundle.sha256,
      size: 100,
      channel: 'production',
      runtimeVersion: 'rt-1',
      releaseId: 's',
      strategy: 'zip',
      forceImmediate: false,
      encryption: null,
      signature: expect.objectContaining({ kid: 'test-kid' }),
      url: 'https://cdn.test/bundles/s.zip',
    });
    expect(
      verifies(
        buildCanonicalPayload(
          {
            appId: 'app-1',
            channel: 'production',
            version: '1.0.s',
            sha256: stable.bundle.sha256,
            size: 100,
            runtimeVersion: 'rt-1',
          },
          manifest.signature.kid,
          manifest.signature.iat,
          manifest.signature.exp,
        ),
        manifest.signature,
      ),
    ).toBe(true);
  });

  it('keeps the stable release on top and signs the rolling block separately', async () => {
    const stable = release('s', 100);
    const rolling = { ...release('r', 25), forceImmediate: true };
    await writeManifestFile('app-1', 'production', 'rt-1', { stable, rolling });

    const manifest = writtenManifest();
    expect(manifest).toMatchObject({
      version: '1.0.s',
      releaseId: 's',
      url: 'https://cdn.test/bundles/s.zip',
    });
    expect(manifest.rollout).toEqual({
      version: '1.0.r',
      sha256: rolling.bundle.sha256,
      size: 100,
      runtimeVersion: 'rt-1',
      releaseId: 'r',
      strategy: 'zip',
      forceImmediate: true,
      encryption: null,
      percent: 25,
      stableSha256: stable.bundle.sha256,
      signature: expect.objectContaining({ kid: 'test-kid' }),
      url: 'https://cdn.test/bundles/r.zip',
    });
    const signature = manifest.rollout!.signature;
    const fields = {
      appId: 'app-1',
      channel: 'production',
      version: '1.0.r',
      sha256: rolling.bundle.sha256,
      size: 100,
      runtimeVersion: 'rt-1',
      forceImmediate: true,
      percent: 25,
      releaseId: 'r',
      stableSha256: stable.bundle.sha256,
    };
    expect(
      verifies(buildRolloutPayload(fields, signature.kid, signature.iat, signature.exp), signature),
    ).toBe(true);
    expect(
      verifies(
        buildRolloutPayload(
          { ...fields, channel: 'staging' },
          signature.kid,
          signature.iat,
          signature.exp,
        ),
        signature,
      ),
    ).toBe(false);
  });

  it('expands the rolling bundle file list for the deltas strategy', async () => {
    const stable = release('s', 100);
    const rolling = release('r', 5, { strategy: 'deltas', storageKey: 'bundles/r.json' });
    storage.getTextObject.mockResolvedValue(
      JSON.stringify({ files: [{ path: 'index.html', sha256: 'f'.repeat(64), size: 7 }] }),
    );

    await writeManifestFile('app-1', 'production', 'rt-1', { stable, rolling });

    expect(storage.getTextObject).toHaveBeenCalledWith('bundles/r.json');
    const manifest = writtenManifest();
    expect(manifest.url).toBe('https://cdn.test/bundles/s.zip');
    expect(manifest.rollout).toMatchObject({
      strategy: 'deltas',
      filesHash: rolling.bundle.sha256,
      files: [
        {
          path: 'index.html',
          sha256: 'f'.repeat(64),
          size: 7,
          url: `https://cdn.test/files/app-1/${'f'.repeat(64)}`,
        },
      ],
    });
    expect(manifest.rollout).not.toHaveProperty('url');
  });
});

describe('restoreManifestFilesForApp', () => {
  it('restores every healthy lane even when one lane cannot be published', async () => {
    storage.putTextObject.mockReset();
    storage.listStorageKeys.mockResolvedValue([]);
    database.app.findUnique.mockResolvedValue({ organization: { usageBlocked: false } });
    database.release.findMany.mockResolvedValue([
      { ...release('r', 10), channel: 'broken' },
      { ...release('s', 100), channel: 'production' },
    ]);

    await expect(restoreManifestFilesForApp('app-1')).rejects.toThrow(
      /Could not restore 1 manifest\(s\) for app app-1: .*without a stable release/,
    );
    expect(storage.putTextObject).toHaveBeenCalledTimes(1);
    expect(storage.putTextObject.mock.calls[0][0]).toMatchObject({
      storageKey: 'manifests/app-1/production/rt-1/manifest.json',
    });
  });
});
