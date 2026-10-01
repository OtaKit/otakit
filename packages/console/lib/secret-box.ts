import crypto from 'node:crypto';

/**
 * At-rest encryption for secrets the console must read again to use, such as
 * webhook signing secrets. AES-256-GCM with a random IV per value.
 *
 * Sealed format: `v1.<iv>.<ciphertext>.<tag>` (base64url parts). The `aad` binds a
 * value to the row it belongs to (for example `notification-destination:<id>`), so a
 * ciphertext copied into another row fails to open. The format and key
 * (DATA_ENCRYPTION_KEY) match the push add-on's own copy in @otakit/push-server.
 */

const VERSION = 'v1';
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error('DATA_ENCRYPTION_KEY is not set');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  }
  cachedKey = key;
  return key;
}

export function encryptSecret(plaintext: string, aad: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, ciphertext, tag]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function decryptSecret(sealed: string, aad: string): string {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unsupported sealed secret format');
  }
  const [, ivPart, ciphertextPart, tagPart] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Test hook: forget the cached key after changing the environment. */
export function resetSecretBoxKeyForTests(): void {
  cachedKey = null;
}
