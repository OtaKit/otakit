import crypto from 'node:crypto';

const SECRET_KEY_PREFIX = 'otakit_sk_';
const GENERATED_SECRET_KEY_BYTES = 32;
const KEY_PREFIX_LENGTH = 12;

export function hashOrganizationApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function generateOrganizationApiKey(): {
  rawKey: string;
  keyHash: string;
  keyPrefix: string;
} {
  const randomPart = crypto.randomBytes(GENERATED_SECRET_KEY_BYTES).toString('base64url');
  const rawKey = `${SECRET_KEY_PREFIX}${randomPart}`;
  return {
    rawKey,
    keyHash: hashOrganizationApiKey(rawKey),
    keyPrefix: rawKey.slice(0, KEY_PREFIX_LENGTH),
  };
}
