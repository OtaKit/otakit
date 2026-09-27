import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appFindUnique: vi.fn(),
  deviceFindUnique: vi.fn(),
  deviceUpdate: vi.fn(),
  deviceCount: vi.fn(),
  deviceUpsert: vi.fn(),
  deviceDeleteMany: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    app: { findUnique: mocks.appFindUnique },
    pushDevice: {
      findUnique: mocks.deviceFindUnique,
      update: mocks.deviceUpdate,
      count: mocks.deviceCount,
      upsert: mocks.deviceUpsert,
      deleteMany: mocks.deviceDeleteMany,
    },
  },
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));

import { DELETE, OPTIONS, POST } from './route';

const APP_ID = '65bb56c1-8279-4a71-a010-7a78ca96e613';
const IOS_TOKEN = 'a'.repeat(64);

function request(method: string, body?: unknown, appId: string | null = APP_ID) {
  return new NextRequest('https://console.example/api/v1/push/devices', {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.7',
      ...(appId ? { 'x-app-id': appId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('POST /api/v1/push/devices', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.appFindUnique.mockResolvedValue({
      id: APP_ID,
      organizationId: 'org-1',
      organization: { planKey: 'free' },
    });
    mocks.deviceFindUnique.mockResolvedValue(null);
    mocks.deviceCount.mockResolvedValue(0);
    mocks.deviceUpsert.mockResolvedValue({ id: 'device-1' });
  });

  it('answers CORS preflight for Capacitor origins', () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toContain('X-App-Id');
  });

  it('registers a new iOS device with OTA context', async () => {
    const response = await POST(
      request('POST', {
        token: IOS_TOKEN.toUpperCase(),
        platform: 'ios',
        topics: ['news'],
        channel: 'beta',
        externalUserId: 'user_1',
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      deviceId: 'device-1',
      created: true,
    });
    const upsert = mocks.deviceUpsert.mock.calls[0][0];
    expect(upsert.create).toMatchObject({
      appId: APP_ID,
      token: IOS_TOKEN,
      provider: 'apns',
      platform: 'ios',
      environment: 'production',
      topics: ['news'],
      channel: 'beta',
      externalUserId: 'user_1',
    });
  });

  it('updates a known device without counting it against the limit', async () => {
    mocks.deviceFindUnique.mockResolvedValue({ id: 'device-9' });
    const response = await POST(request('POST', { token: 'fcm-token:abc', platform: 'android' }));
    expect(response.status).toBe(200);
    expect(mocks.deviceCount).not.toHaveBeenCalled();
    expect(mocks.deviceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'device-9' } }),
    );
  });

  it('never fails the app when the plan limit is reached', async () => {
    mocks.deviceCount.mockResolvedValue(10_000);
    const response = await POST(request('POST', { token: IOS_TOKEN, platform: 'ios' }));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: false, reason: 'device_limit' });
    expect(mocks.deviceUpsert).not.toHaveBeenCalled();
  });

  it('rejects malformed tokens and unknown apps', async () => {
    expect((await POST(request('POST', { token: 'not-hex', platform: 'ios' }))).status).toBe(400);
    mocks.appFindUnique.mockResolvedValue(null);
    expect((await POST(request('POST', { token: IOS_TOKEN, platform: 'ios' }))).status).toBe(404);
    expect((await POST(request('POST', { token: IOS_TOKEN, platform: 'ios' }, null))).status).toBe(
      401,
    );
  });

  it('rate limits by IP and app', async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false });
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: true });
    const response = await POST(request('POST', { token: IOS_TOKEN, platform: 'ios' }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('unregisters a device', async () => {
    mocks.deviceDeleteMany.mockResolvedValue({ count: 1 });
    const response = await DELETE(request('DELETE', { token: IOS_TOKEN.toUpperCase() }));
    expect(response.status).toBe(200);
    expect(mocks.deviceDeleteMany).toHaveBeenCalledWith({
      where: { appId: APP_ID, token: IOS_TOKEN },
    });
  });
});
