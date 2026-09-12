import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fields = {
  appId: 'app-1',
  channel: 'production',
  version: '1.2.3',
  sha256: 'a'.repeat(64),
  size: 100,
  runtimeVersion: 'A'.repeat(43),
  platform: 'ios' as const,
  contentHash: 'b'.repeat(64),
  releaseId: 'release-1',
};
const v2 = [
  'MANIFEST',
  'appId:app-1',
  'channel:production',
  'version:1.2.3',
  `sha256:${'a'.repeat(64)}`,
  'size:100',
  `runtimeVersion:${'A'.repeat(43)}`,
  'strategy:zip',
  'forceImmediate:false',
  'encryption:null',
  'kid:test-key',
  'iat:1000',
  'exp:31537000',
].join('\n');
const v3 = [
  'MANIFEST:3',
  'appId:app-1',
  'framework:react-native',
  'platform:ios',
  'channel:"production"',
  'version:1.2.3',
  `sha256:${'a'.repeat(64)}`,
  `contentHash:${'b'.repeat(64)}`,
  'size:100',
  `runtimeVersion:${'A'.repeat(43)}`,
  'strategy:zip',
  'forceImmediate:false',
  'encryption:null',
  'releaseId:release-1',
  'kid:test-key',
  'iat:1000',
  'exp:31537000',
].join('\n');

describe('manifest signature contracts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('matches native ZIP, encrypted ZIP and delta fixtures byte-for-byte', async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL('../../updater-core/fixtures/artifacts-v3.json', import.meta.url),
        'utf8',
      ),
    );
    const { buildRNCanonicalPayload } = await import('./manifest-signing');
    const publicKey = createPublicKey({
      key: Buffer.from(fixture.publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    for (const item of fixture.cases) {
      const { signature, ...fields } = item.manifest;
      const canonical = buildRNCanonicalPayload(
        fields,
        signature.kid,
        signature.iat,
        signature.exp,
      );
      expect(canonical).toBe(item.canonical);
      expect(
        verify(
          'sha256',
          Buffer.from(canonical),
          publicKey,
          Buffer.from(signature.sig, 'base64url'),
        ),
      ).toBe(true);
    }
  });

  it('keeps the Capacitor v2 payload byte-for-byte and verifies RN v3 against an independent literal', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    vi.stubEnv(
      'MANIFEST_SIGNING_KEY',
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    vi.stubEnv('MANIFEST_SIGNING_KID', 'test-key');
    vi.stubEnv('MANIFEST_SIGNING_DISABLED', 'false');
    const signer = await import('./manifest-signing');
    expect(signer.buildCanonicalPayload(fields, 'test-key', 1000, 31537000)).toBe(v2);
    expect(signer.buildRNCanonicalPayload(fields, 'test-key', 1000, 31537000)).toBe(v3);
    const cap = signer.signManifest(fields)!;
    const rn = signer.signRNManifest(fields);
    expect(verify('sha256', Buffer.from(v2), publicKey, Buffer.from(cap.sig, 'base64url'))).toBe(
      true,
    );
    expect(verify('sha256', Buffer.from(v3), publicKey, Buffer.from(rn.sig, 'base64url'))).toBe(
      true,
    );
    expect(verify('sha256', Buffer.from(v2), publicKey, Buffer.from(rn.sig, 'base64url'))).toBe(
      false,
    );
    // crypto.verify's default encoding is DER, independently of the signer.
    for (const [original, replacement] of [
      ['platform:ios', 'platform:android'],
      ['framework:react-native', 'framework:capacitor'],
      ['releaseId:release-1', 'releaseId:release-2'],
      [`contentHash:${'b'.repeat(64)}`, `contentHash:${'c'.repeat(64)}`],
      ['forceImmediate:false', 'forceImmediate:true'],
      ['channel:"production"', 'channel:"beta"'],
    ]) {
      expect(
        verify(
          'sha256',
          Buffer.from(v3.replace(original, replacement)),
          publicKey,
          Buffer.from(rn.sig, 'base64url'),
        ),
      ).toBe(false);
    }
  });

  it('distinguishes the base channel from a channel literally named null in RN', async () => {
    const { buildRNCanonicalPayload } = await import('./manifest-signing');
    const base = buildRNCanonicalPayload({ ...fields, channel: null }, 'test-key', 1000, 31537000);
    const named = buildRNCanonicalPayload(
      { ...fields, channel: 'null' },
      'test-key',
      1000,
      31537000,
    );
    expect(base).toContain('\nchannel:null\n');
    expect(named).toContain('\nchannel:"null"\n');
    expect(named).not.toBe(base);
  });

  it('retains Capacitor unsigned mode but never produces an unsigned RN manifest', async () => {
    vi.stubEnv('MANIFEST_SIGNING_DISABLED', 'true');
    const { signManifest, signRNManifest } = await import('./manifest-signing');
    expect(signManifest(fields)).toBeNull();
    expect(() => signRNManifest(fields)).toThrow('require signing');
  });

  it('rejects a non-P-256 RN signing key', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    vi.stubEnv(
      'MANIFEST_SIGNING_KEY',
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );
    vi.stubEnv('MANIFEST_SIGNING_KID', 'test-key');
    vi.stubEnv('MANIFEST_SIGNING_DISABLED', 'false');
    const { signRNManifest } = await import('./manifest-signing');
    expect(() => signRNManifest(fields)).toThrow('P-256');
  });
});
