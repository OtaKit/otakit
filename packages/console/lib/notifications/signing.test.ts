import { Webhook } from 'standardwebhooks';
import { describe, expect, it } from 'vitest';

import { generateWebhookSecret, signWebhook } from './signing';

describe('webhook signing', () => {
  it('generates whsec_ secrets with 32 random bytes', () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(secret.slice('whsec_'.length), 'base64')).toHaveLength(32);
    expect(generateWebhookSecret()).not.toBe(secret);
  });

  it('matches the Standard Webhooks reference library', () => {
    const secret = generateWebhookSecret();
    const id = 'f2a4c9de-6d8e-4f0a-9d55-0b0c1d2e3f40';
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ type: 'release.published', data: { text: 'Grüße ✓' } });
    const signature = signWebhook({ id, timestamp, body, secrets: [secret] });

    expect(signature).toBe(new Webhook(secret).sign(id, new Date(timestamp * 1000), body));
    expect(
      new Webhook(secret).verify(body, {
        'webhook-id': id,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': signature,
      }),
    ).toEqual(JSON.parse(body));
  });

  it('signs with every secret during a rotation, so either one verifies', () => {
    const [current, previous] = [generateWebhookSecret(), generateWebhookSecret()];
    const headers = (signature: string) => ({
      'webhook-id': 'id-1',
      'webhook-timestamp': String(timestamp),
      'webhook-signature': signature,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhook({
      id: 'id-1',
      timestamp,
      body: '{}',
      secrets: [current, previous],
    });

    expect(signature.split(' ')).toHaveLength(2);
    expect(new Webhook(current).verify('{}', headers(signature))).toEqual({});
    expect(new Webhook(previous).verify('{}', headers(signature))).toEqual({});
    expect(() => new Webhook(generateWebhookSecret()).verify('{}', headers(signature))).toThrow();
  });

  it('refuses a secret without the whsec_ prefix', () => {
    expect(() => signWebhook({ id: 'x', timestamp: 1, body: '{}', secrets: ['abc'] })).toThrow(
      /whsec_/,
    );
  });
});
