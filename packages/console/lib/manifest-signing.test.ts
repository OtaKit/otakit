import crypto from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCanonicalPayload, buildRolloutPayload } from './manifest-signing';

/**
 * Cross-implementation vector: the same fixture is verified by
 * RolloutTests.swift and RolloutTest.java, so a payload drift on any of the
 * three sides fails a test instead of silently dropping rollouts on devices.
 */
const VECTOR_PUBLIC_KEY_DER =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE5baepIzUs2xSVqfJIjpzSlW5qPYH7WRpYKc+GESnncgO+5+a1eEpDet39AAocMdRIM4fM5z+/WGIlQiqeK3LfA==';
const VECTOR_MANIFEST = {
  version: '1.4.1',
  sha256: '1111111111111111111111111111111111111111111111111111111111111111',
  size: 123,
  runtimeVersion: '2026.10',
  releaseId: '0f5c1f55-9d3a-4a36-9b0e-6d7f2b1c0a01',
  strategy: 'zip',
  forceImmediate: false,
  encryption: null,
  channel: 'production',
  signature: {
    kid: 'rollout-test-key',
    sig: 'MEYCIQDc7L5nYPzyKYIL-42ou9LK5f5QBuP2OMAbDUsQgBZK2QIhAJpFW7IKkiWS3FxXXwfgksWJapHUWzx4us8q_bzn1vMC',
    iat: 1790000000,
    exp: 2145916800,
  },
  url: 'https://cdn.otakit.app/bundles/stable.zip',
  rollout: {
    version: '1.4.2',
    sha256: '2222222222222222222222222222222222222222222222222222222222222222',
    size: 130,
    runtimeVersion: '2026.10',
    releaseId: 'f32627ca-9e8c-4358-90d8-bde732400081',
    strategy: 'zip',
    forceImmediate: true,
    encryption: {
      alg: 'A256GCM',
      kid: 'bundle-key',
      wrapNonce: 'd3JhcE5vbmNl',
      wrappedDek: 'd3JhcHBlZERlaw',
      nonce: 'bm9uY2U',
    },
    percent: 10,
    stableSha256: '1111111111111111111111111111111111111111111111111111111111111111',
    signature: {
      kid: 'rollout-test-key',
      sig: 'MEUCIQCotWyY41G-mCIwoYMSpRlbgUC_zCRmVG9TaGNDZ2JdWAIgH4mQtFOVrDjNoXUVZZHYtGey-KA77jTWw2q7n-fI9TU',
      iat: 1790000000,
      exp: 2145916800,
    },
    url: 'https://cdn.otakit.app/bundles/rolling.zip',
  },
} as const;

function verifyVector(payload: string, sig: string): boolean {
  const key = crypto.createPublicKey({
    key: Buffer.from(VECTOR_PUBLIC_KEY_DER, 'base64'),
    format: 'der',
    type: 'spki',
  });
  return crypto.verify('sha256', Buffer.from(payload, 'utf-8'), key, Buffer.from(sig, 'base64url'));
}

describe('manifest payloads', () => {
  it('keeps the v2 top-level payload byte-for-byte unchanged', () => {
    const { signature, ...manifest } = VECTOR_MANIFEST;
    const payload = buildCanonicalPayload(
      { appId: '7bb828f1-797c-4d07-8254-068cac664f69', ...manifest, strategy: 'zip' },
      signature.kid,
      signature.iat,
      signature.exp,
    );

    expect(payload).toBe(
      [
        'MANIFEST',
        'appId:7bb828f1-797c-4d07-8254-068cac664f69',
        'channel:production',
        'version:1.4.1',
        'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        'size:123',
        'runtimeVersion:2026.10',
        'strategy:zip',
        'forceImmediate:false',
        'encryption:null',
        'kid:rollout-test-key',
        'iat:1790000000',
        'exp:2145916800',
      ].join('\n'),
    );
    expect(verifyVector(payload, signature.sig)).toBe(true);
  });

  it('builds the rollout payload that the plugins verify', () => {
    const { signature, ...rollout } = VECTOR_MANIFEST.rollout;
    const payload = buildRolloutPayload(
      {
        appId: '7bb828f1-797c-4d07-8254-068cac664f69',
        channel: 'production',
        ...rollout,
        strategy: 'zip',
      },
      signature.kid,
      signature.iat,
      signature.exp,
    );

    expect(payload).toBe(
      [
        'ROLLOUT',
        'appId:7bb828f1-797c-4d07-8254-068cac664f69',
        'channel:production',
        'version:1.4.2',
        'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        'size:130',
        'runtimeVersion:2026.10',
        'strategy:zip',
        'forceImmediate:true',
        'encryption:A256GCM|bundle-key|d3JhcE5vbmNl|d3JhcHBlZERlaw|bm9uY2U',
        'percent:10',
        'releaseId:f32627ca-9e8c-4358-90d8-bde732400081',
        'stableSha256:1111111111111111111111111111111111111111111111111111111111111111',
        'notesSha256:null',
        'kid:rollout-test-key',
        'iat:1790000000',
        'exp:2145916800',
      ].join('\n'),
    );
    expect(verifyVector(payload, signature.sig)).toBe(true);
  });

  it('never lets a signature verify for the other block', () => {
    const { signature, ...rollout } = VECTOR_MANIFEST.rollout;
    const asTopLevel = buildCanonicalPayload(
      { appId: '7bb828f1-797c-4d07-8254-068cac664f69', channel: 'production', ...rollout },
      signature.kid,
      signature.iat,
      signature.exp,
    );
    expect(verifyVector(asTopLevel, signature.sig)).toBe(false);

    const tampered = buildRolloutPayload(
      {
        appId: '7bb828f1-797c-4d07-8254-068cac664f69',
        channel: 'production',
        ...rollout,
        percent: 100,
      },
      signature.kid,
      signature.iat,
      signature.exp,
    );
    expect(verifyVector(tampered, signature.sig)).toBe(false);
  });
});

describe('signRollout', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('signs the rollout payload with the manifest key', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    vi.stubEnv('MANIFEST_SIGNING_DISABLED', '');
    vi.stubEnv('MANIFEST_SIGNING_KID', 'test-kid');
    vi.stubEnv(
      'MANIFEST_SIGNING_KEY',
      privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    );
    vi.resetModules();
    const signing = await import('./manifest-signing');
    const fields = {
      appId: 'app',
      channel: null,
      version: '2.0.0',
      sha256: 'a'.repeat(64),
      size: 1,
      runtimeVersion: null,
      percent: 25,
      releaseId: 'release',
      stableSha256: 'b'.repeat(64),
    };

    const signature = signing.signRollout(fields);

    expect(signature).toMatchObject({ kid: 'test-kid' });
    expect(signature!.exp - signature!.iat).toBe(31_536_000);
    const payload = signing.buildRolloutPayload(
      fields,
      signature!.kid,
      signature!.iat,
      signature!.exp,
    );
    expect(
      crypto.verify(
        'sha256',
        Buffer.from(payload, 'utf-8'),
        publicKey,
        Buffer.from(signature!.sig, 'base64url'),
      ),
    ).toBe(true);
  });

  it('returns null when manifest signing is disabled', async () => {
    vi.stubEnv('MANIFEST_SIGNING_DISABLED', 'true');
    vi.resetModules();
    const signing = await import('./manifest-signing');

    expect(
      signing.signRollout({
        appId: 'app',
        channel: null,
        version: '2.0.0',
        sha256: 'a'.repeat(64),
        size: 1,
        runtimeVersion: null,
        percent: 25,
        releaseId: 'release',
        stableSha256: 'b'.repeat(64),
      }),
    ).toBeNull();
  });
});
