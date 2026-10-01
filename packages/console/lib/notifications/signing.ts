import crypto from 'node:crypto';

/**
 * Webhook signatures per the Standard Webhooks spec (standardwebhooks.com), so
 * receivers can verify with the reference libraries:
 * `webhook-signature: v1,<base64 HMAC-SHA256 of "<id>.<timestamp>.<body>">`, keyed
 * with the base64-decoded part of the `whsec_` secret. During a secret rotation
 * both secrets sign, separated by a space.
 */

const SECRET_PREFIX = 'whsec_';
const SECRET_BYTES = 32;

export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${crypto.randomBytes(SECRET_BYTES).toString('base64')}`;
}

function secretKey(secret: string): Buffer {
  if (!secret.startsWith(SECRET_PREFIX)) {
    throw new Error('Webhook secret must start with whsec_');
  }
  return Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64');
}

export function signWebhook(input: {
  id: string;
  timestamp: number;
  body: string;
  secrets: string[];
}): string {
  const content = `${input.id}.${input.timestamp}.${input.body}`;
  return input.secrets
    .map(
      (secret) =>
        `v1,${crypto.createHmac('sha256', secretKey(secret)).update(content).digest('base64')}`,
    )
    .join(' ');
}
