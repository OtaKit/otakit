import { describe, expect, it, vi } from 'vitest';

import type { ApnsResult } from './apns';
import { audienceWhere } from './audience';
import { sendToDevices } from './deliver';
import type { FcmResult } from './fcm';
import { assertPayloadFits, buildApnsPayload, buildFcmMessage, pushPayloadSchema } from './payload';

const apnsCredential = {
  id: 'apns-1',
  keyId: 'ABC123DEFG',
  teamId: 'TEAM123456',
  bundleId: 'com.example.app',
  privateKeyPem: 'unused-by-fake-sender',
};
const fcmCredential = {
  id: 'fcm-1',
  serviceAccount: { project_id: 'p', client_email: 'e', private_key: 'k' },
};
const payload = { title: 'Hello', body: 'World', url: '/inbox', data: { orderId: '42' } };

describe('payload', () => {
  it('builds APNs and FCM messages with the deep link', () => {
    expect(buildApnsPayload(payload)).toEqual({
      aps: { alert: { title: 'Hello', body: 'World' }, sound: 'default' },
      orderId: '42',
      url: '/inbox',
    });
    expect(buildFcmMessage(payload)).toEqual({
      notification: { title: 'Hello', body: 'World' },
      data: { orderId: '42', url: '/inbox' },
      android: { priority: 'HIGH', ttl: '86400s' },
    });
  });

  it('rejects reserved data keys, bad links and oversized messages', () => {
    expect(pushPayloadSchema.safeParse({ ...payload, data: { aps: 'x' } }).success).toBe(false);
    expect(pushPayloadSchema.safeParse({ ...payload, url: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    const big = {
      title: 't',
      body: 'b',
      data: Object.fromEntries([...Array(20)].map((_, i) => [`k${i}`, 'x'.repeat(250)])),
    };
    expect(() => assertPayloadFits(big)).toThrow(/Apple allows 4096/);
  });
});

describe('audienceWhere', () => {
  it('combines filter kinds with AND and values with OR', () => {
    expect(
      audienceWhere('app-1', {
        platforms: ['ios'],
        topics: ['news', 'offers'],
        channels: ['beta'],
      }),
    ).toEqual({
      appId: 'app-1',
      platform: { in: ['ios'] },
      channel: { in: ['beta'] },
      topics: { hasSome: ['news', 'offers'] },
    });
    expect(audienceWhere('app-1', {})).toEqual({ appId: 'app-1' });
  });
});

describe('sendToDevices', () => {
  const devices = [
    {
      id: 'ios-prod',
      token: 'a'.repeat(64),
      provider: 'apns' as const,
      environment: 'production' as const,
    },
    {
      id: 'ios-dev',
      token: 'b'.repeat(64),
      provider: 'apns' as const,
      environment: 'production' as const,
    },
    {
      id: 'ios-gone',
      token: 'c'.repeat(64),
      provider: 'apns' as const,
      environment: 'production' as const,
    },
    {
      id: 'android-ok',
      token: 'fcm-1',
      provider: 'fcm' as const,
      environment: 'production' as const,
    },
    {
      id: 'android-busy',
      token: 'fcm-2',
      provider: 'fcm' as const,
      environment: 'production' as const,
    },
  ];

  it('sends, falls back to sandbox for development tokens, and sorts the results', async () => {
    const apns = vi.fn(
      async ({ environment, items }): Promise<ApnsResult[]> =>
        items.map((item: { deviceId: string }) => {
          if (item.deviceId === 'ios-gone')
            return {
              deviceId: item.deviceId,
              kind: 'invalid',
              status: 410,
              reason: 'Unregistered',
            };
          if (item.deviceId === 'ios-dev' && environment === 'production') {
            return {
              deviceId: item.deviceId,
              kind: 'invalid',
              status: 400,
              reason: 'BadDeviceToken',
            };
          }
          return { deviceId: item.deviceId, kind: 'ok', status: 200 };
        }),
    );
    const fcm = vi.fn(
      async ({ items }): Promise<FcmResult[]> =>
        items.map((item: { deviceId: string }) =>
          item.deviceId === 'android-busy'
            ? {
                deviceId: item.deviceId,
                kind: 'retry',
                status: 429,
                reason: 'QUOTA_EXCEEDED',
                retryAfterSeconds: 120,
              }
            : { deviceId: item.deviceId, kind: 'ok', status: 200 },
        ),
    );

    const outcome = await sendToDevices({
      devices,
      payload,
      campaignId: 'campaign-1',
      apns: apnsCredential,
      fcm: fcmCredential,
      senders: { apns, fcm } as never,
    });

    expect(outcome.accepted).toBe(3);
    expect(outcome.sandboxDeviceIds).toEqual(['ios-dev']);
    expect(outcome.invalidDeviceIds).toEqual(['ios-gone']);
    expect(outcome.retryDeviceIds).toEqual(['android-busy']);
    expect(outcome.retryAfterSeconds).toBe(120);
    expect(outcome.authFailure).toBeNull();
    expect(apns).toHaveBeenCalledTimes(2);
    expect(apns.mock.calls[1][0]).toMatchObject({
      environment: 'sandbox',
      collapseId: 'campaign-1',
    });
  });

  it('reports the sandbox reason instead of deleting when the retry fails differently', async () => {
    const outcome = await sendToDevices({
      devices: devices.slice(1, 2),
      payload,
      campaignId: 'c',
      apns: apnsCredential,
      fcm: null,
      senders: {
        apns: vi.fn(async ({ environment }) => [
          environment === 'production'
            ? { deviceId: 'ios-dev', kind: 'invalid', status: 400, reason: 'BadDeviceToken' }
            : { deviceId: 'ios-dev', kind: 'auth', status: 400, reason: 'TopicDisallowed' },
        ]),
        fcm: vi.fn(),
      } as never,
    });
    expect(outcome.invalidDeviceIds).toEqual([]);
    expect(outcome.authFailure).toMatch(/Register the bundle ID as an App ID/);
    expect(outcome.errors).toEqual({ 'apns:TopicDisallowed': 1 });
  });

  it('counts devices without credentials as failed', async () => {
    const outcome = await sendToDevices({
      devices,
      payload,
      campaignId: 'c',
      apns: null,
      fcm: null,
      senders: { apns: vi.fn(), fcm: vi.fn() } as never,
    });
    expect(outcome.failed).toBe(5);
    expect(outcome.errors).toEqual({ 'apns:not_configured': 3, 'fcm:not_configured': 2 });
  });

  it('reports a credential rejection so the campaign can stop', async () => {
    const outcome = await sendToDevices({
      devices: devices.slice(0, 1),
      payload,
      campaignId: 'c',
      apns: apnsCredential,
      fcm: null,
      senders: {
        apns: vi.fn(async () => [
          { deviceId: 'ios-prod', kind: 'auth', status: 403, reason: 'InvalidProviderToken' },
        ]),
        fcm: vi.fn(),
      } as never,
    });
    expect(outcome.authFailure).toMatch(/Apple rejected the credentials \(InvalidProviderToken\)/);
    expect(outcome.failed).toBe(1);
  });
});
