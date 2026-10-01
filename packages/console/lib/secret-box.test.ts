import crypto from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, resetSecretBoxKeyForTests } from './secret-box';

const originalKey = process.env.DATA_ENCRYPTION_KEY;

describe('secret-box', () => {
  beforeEach(() => {
    process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    resetSecretBoxKeyForTests();
  });

  afterEach(() => {
    process.env.DATA_ENCRYPTION_KEY = originalKey;
    resetSecretBoxKeyForTests();
  });

  it('round-trips a secret', () => {
    const sealed = encryptSecret('whsec_abc', 'notification-destination:a');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(decryptSecret(sealed, 'notification-destination:a')).toBe('whsec_abc');
  });

  it('uses a fresh IV for every value', () => {
    expect(encryptSecret('same', 'aad')).not.toBe(encryptSecret('same', 'aad'));
  });

  it('rejects a ciphertext moved to another row', () => {
    const sealed = encryptSecret('secret', 'notification-destination:a');
    expect(() => decryptSecret(sealed, 'notification-destination:b')).toThrow();
  });

  it('rejects a tampered ciphertext', () => {
    const sealed = encryptSecret('secret', 'aad');
    const parts = sealed.split('.');
    const body = Buffer.from(parts[2], 'base64url');
    body[0] ^= 0xff;
    parts[2] = body.toString('base64url');
    expect(() => decryptSecret(parts.join('.'), 'aad')).toThrow();
  });

  it('refuses a key of the wrong length', () => {
    process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(16).toString('base64');
    resetSecretBoxKeyForTests();
    expect(() => encryptSecret('x', 'aad')).toThrow(/32 bytes/);
  });

  it('refuses an unknown format', () => {
    expect(() => decryptSecret('v9.a.b.c', 'aad')).toThrow(/format/);
  });
});
