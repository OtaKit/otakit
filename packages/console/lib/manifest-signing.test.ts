import crypto from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCanonicalPayload,
  buildConfigPayload,
  buildNotesPayload,
  buildRolloutPayload,
} from './manifest-signing';

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

/**
 * Release notes vector (plugin 3.3+), with its own key: a complete manifest
 * whose top level, rollout block and both notes blocks are signed. The text
 * covers non-ASCII, a tab, a line break and a 4-byte character. Verified by
 * ReleaseNotesTests.swift and ReleaseNotesTest.java.
 */
const NOTES_VECTOR_PUBLIC_KEY_DER =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEkGEUgoH9yaIEaWpJltHsu43ogXXdRAwdqNSnw+m14d4Q10mwUUcQ2QFiwHzwQjShpvlC8pY70jK8EnLGPt3JTA==';
const NOTES_VECTOR_MANIFEST = {
  version: '1.5.0',
  sha256: '3333333333333333333333333333333333333333333333333333333333333333',
  size: 140,
  runtimeVersion: '2026.10',
  strategy: 'zip',
  forceImmediate: false,
  encryption: null,
  releaseId: '5b0e3c1a-6c4f-4b7e-9a1d-2f8e7c6b5a40',
  channel: 'production',
  signature: {
    kid: 'notes-test-key',
    sig: 'MEYCIQCpkHRddZEHgnEqyvFAP6v0ybbmKeQsGg4-rb30M2QlUQIhAMckbYBJoixOBz3a2oUIITMePtWZx_Cl1tDnXaestZ5l',
    iat: 1790000000,
    exp: 2145916800,
  },
  url: 'https://cdn.otakit.app/bundles/notes-stable.zip',
  notes: {
    text: 'Faster checkout.\nPhotos load 2× faster on Android.\tMerci, café 🚀',
    signature: {
      kid: 'notes-test-key',
      sig: 'MEQCICV24IsfkI_axwR-xKFTRi6RMNhdJM3onk3x-leodaiSAiAvR6ki-Cr6h1a7BJqq_3P8I-jtKpwoEHUSHoUQ6tequQ',
      iat: 1790000000,
      exp: 2145916800,
    },
  },
  rollout: {
    version: '1.5.1',
    sha256: '4444444444444444444444444444444444444444444444444444444444444444',
    size: 150,
    runtimeVersion: '2026.10',
    strategy: 'zip',
    forceImmediate: false,
    encryption: null,
    releaseId: 'c2d4e6f8-1a3b-4c5d-8e7f-90a1b2c3d4e5',
    percent: 20,
    stableSha256: '3333333333333333333333333333333333333333333333333333333333333333',
    signature: {
      kid: 'notes-test-key',
      sig: 'MEYCIQDqwD5jJLq9Hsp_6JDncZVBcL7drlYB8mqV6-35ID3JJgIhAJmcp1lUYSPO6SFb6EP6ISd6ij834dym1-fAwzoHznC2',
      iat: 1790000000,
      exp: 2145916800,
    },
    url: 'https://cdn.otakit.app/bundles/notes-rolling.zip',
    notes: {
      text: 'Beta: new home screen',
      signature: {
        kid: 'notes-test-key',
        sig: 'MEYCIQD9N9zyNPpXZvpTgKOFEXrPjsThpU3AxPznEWWJKctVhQIhAM-1u2T8Q0JEelCPmND6Zp9Lpnclw4O3xgd0ktxL3CO9',
        iat: 1790000000,
        exp: 2145916800,
      },
    },
  },
} as const;

function verifyWith(publicKeyDer: string, payload: string, sig: string): boolean {
  const key = crypto.createPublicKey({
    key: Buffer.from(publicKeyDer, 'base64'),
    format: 'der',
    type: 'spki',
  });
  return crypto.verify('sha256', Buffer.from(payload, 'utf-8'), key, Buffer.from(sig, 'base64url'));
}

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

describe('release notes payload', () => {
  const appId = '7bb828f1-797c-4d07-8254-068cac664f69';
  const { notes, rollout, signature, ...stable } = NOTES_VECTOR_MANIFEST;

  it('builds the notes payload that the plugins verify', () => {
    const payload = buildNotesPayload(
      {
        appId,
        channel: 'production',
        releaseId: stable.releaseId,
        sha256: stable.sha256,
        text: notes.text,
      },
      notes.signature.kid,
      notes.signature.iat,
      notes.signature.exp,
    );

    expect(payload).toBe(
      [
        'NOTES',
        `appId:${appId}`,
        'channel:production',
        `releaseId:${stable.releaseId}`,
        `sha256:${stable.sha256}`,
        'notesSha256:d7b1791bd8bae54cc46a8a2d0190ef41061c8e1002db1f9b0ca2a707886e2c54',
        'kid:notes-test-key',
        'iat:1790000000',
        'exp:2145916800',
      ].join('\n'),
    );
    expect(verifyWith(NOTES_VECTOR_PUBLIC_KEY_DER, payload, notes.signature.sig)).toBe(true);
  });

  it('signs the whole vector manifest, so plugins can parse it end to end', () => {
    const top = buildCanonicalPayload(
      { appId, ...stable },
      signature.kid,
      signature.iat,
      signature.exp,
    );
    expect(verifyWith(NOTES_VECTOR_PUBLIC_KEY_DER, top, signature.sig)).toBe(true);

    const { notes: rollingNotes, signature: rolloutSignature, ...rolling } = rollout;
    const rolloutPayload = buildRolloutPayload(
      { appId, channel: 'production', ...rolling },
      rolloutSignature.kid,
      rolloutSignature.iat,
      rolloutSignature.exp,
    );
    expect(verifyWith(NOTES_VECTOR_PUBLIC_KEY_DER, rolloutPayload, rolloutSignature.sig)).toBe(
      true,
    );

    const rollingNotesPayload = buildNotesPayload(
      {
        appId,
        channel: 'production',
        releaseId: rolling.releaseId,
        sha256: rolling.sha256,
        text: rollingNotes.text,
      },
      rollingNotes.signature.kid,
      rollingNotes.signature.iat,
      rollingNotes.signature.exp,
    );
    expect(
      verifyWith(NOTES_VECTOR_PUBLIC_KEY_DER, rollingNotesPayload, rollingNotes.signature.sig),
    ).toBe(true);
  });

  it('never lets notes verify for another release, bundle, lane or text', () => {
    const base = {
      appId,
      channel: 'production' as string | null,
      releaseId: stable.releaseId,
      sha256: stable.sha256,
      text: notes.text,
    };
    for (const moved of [
      { ...base, releaseId: rollout.releaseId },
      { ...base, sha256: rollout.sha256 },
      { ...base, channel: null },
      { ...base, text: notes.text.replace('2×', '2x') },
    ]) {
      const payload = buildNotesPayload(
        moved,
        notes.signature.kid,
        notes.signature.iat,
        notes.signature.exp,
      );
      expect(verifyWith(NOTES_VECTOR_PUBLIC_KEY_DER, payload, notes.signature.sig)).toBe(false);
    }
  });
});

/**
 * Remote config vectors (plugin 3.4+), with their own throwaway key: the same
 * files are verified by RemoteConfigTests.swift and RemoteConfigTest.java.
 */
const CONFIG_VECTOR_PUBLIC_KEY_DER =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEd0ZZZTk/0Z89FsFOcitUJETszNK7A3JeOHfMFCV9dHeuHeVNaEkEdy5kh+PZ/a26LBe8Y+hcPjJBFAC8+u80Ew==';
const CONFIG_VECTOR_FILES = [
  {
    appId: '7bb828f1-797c-4d07-8254-068cac664f69',
    channel: 'production',
    version: 12,
    valuesJson:
      '{"checkoutEnabled":false,"helpUrl":"https://example.com/help","banner":"Zurück um 14:00 ✓","limits":{"upload":25}}',
    experimentsJson: null,
    updatedAt: '2026-10-14T09:00:00.000Z',
    signature: {
      kid: 'config-test-key',
      sig: 'MEYCIQC4BK17uUm7SDkkLMbx6MGEIjsyLKu6-ZEJcSyaRsV44gIhAKuu-KyeVy0WhIZ8BBuu1mRrcktXyCW23JZDTsCn2l2z',
      iat: 1790000000,
      exp: 2145916800,
    },
  },
  {
    appId: '7bb828f1-797c-4d07-8254-068cac664f69',
    channel: null,
    version: 3,
    valuesJson: '{"paywallTitle":"Go Pro","maxItems":5}',
    experimentsJson:
      '[{"key":"paywall_copy","traffic":100,"variants":[{"key":"control","weight":50,"overrides":{}},{"key":"b","weight":50,"overrides":{"paywallTitle":"Unlock everything"}}],"runtimeVersions":null,"goal":"purchase_completed"}]',
    updatedAt: '2026-10-14T09:00:00.000Z',
    signature: {
      kid: 'config-test-key',
      sig: 'MEUCIF3J9XOa6cNJnLyXUJYe-ULxGZGrpeEdUtK6-A6DnPvzAiEA5rjmp9Orhh5urwVBXCo4sUyIGbEvelphqLb_gsTYvhM',
      iat: 1790000000,
      exp: 2145916800,
    },
  },
] as const;

describe('remote config payload', () => {
  it('signs the hashes of the exact JSON text the device receives', () => {
    const [production, base] = CONFIG_VECTOR_FILES;
    const payload = buildConfigPayload(
      production,
      production.signature.kid,
      production.signature.iat,
      production.signature.exp,
    );
    expect(payload).toBe(
      [
        'CONFIG',
        'appId:7bb828f1-797c-4d07-8254-068cac664f69',
        'channel:production',
        'version:12',
        'valuesSha256:93c3bf113784f5be594aa537996ed24994f8fc2a94af39a5af55a013f86a2f0d',
        'experimentsSha256:null',
        'kid:config-test-key',
        'iat:1790000000',
        'exp:2145916800',
      ].join('\n'),
    );
    expect(verifyWith(CONFIG_VECTOR_PUBLIC_KEY_DER, payload, production.signature.sig)).toBe(true);

    const basePayload = buildConfigPayload(
      base,
      base.signature.kid,
      base.signature.iat,
      base.signature.exp,
    );
    expect(basePayload).toContain('\nchannel:null\n');
    expect(basePayload).toContain(
      '\nexperimentsSha256:a82a2ff707af23aa4b266e1b815f88e582ea574468a8d8dc29166ef40789ffa2\n',
    );
    expect(verifyWith(CONFIG_VECTOR_PUBLIC_KEY_DER, basePayload, base.signature.sig)).toBe(true);
  });

  it('never lets a config verify after any signed field changes', () => {
    const [production, base] = CONFIG_VECTOR_FILES;
    for (const moved of [
      { ...production, appId: '00000000-0000-4000-8000-000000000000' },
      { ...production, channel: 'beta' },
      { ...production, channel: null },
      { ...production, version: 13 },
      { ...production, valuesJson: production.valuesJson.replace('false', 'true') },
      { ...production, experimentsJson: base.experimentsJson },
    ]) {
      const payload = buildConfigPayload(
        moved,
        production.signature.kid,
        production.signature.iat,
        production.signature.exp,
      );
      expect(verifyWith(CONFIG_VECTOR_PUBLIC_KEY_DER, payload, production.signature.sig)).toBe(
        false,
      );
    }
    // A manifest or notes signature can never pass as a config one: other header.
    expect(buildConfigPayload(production, 'k', 1, 2).startsWith('CONFIG\n')).toBe(true);
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
