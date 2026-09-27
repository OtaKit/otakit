import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appFindUnique: vi.fn(),
  registerDevice: vi.fn(),
  unregisterDevice: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { app: { findUnique: mocks.appFindUnique } } }));
vi.mock('@/lib/push/service', async (importOriginal) => ({
  // Keep the real schemas: the route validates before push sees the device.
  ...(await importOriginal<typeof import('@/lib/push/service')>()),
  push: { registerDevice: mocks.registerDevice, unregisterDevice: mocks.unregisterDevice },
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
      organization: { pushEnabled: true },
    });
    mocks.registerDevice.mockResolvedValue({ accepted: true, deviceId: 'device-1', created: true });
  });

  it('answers CORS preflight for Capacitor origins', () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toContain('X-App-Id');
  });

  it('registers a device with the app and workspace it belongs to', async () => {
    const response = await POST(
      request('POST', { token: IOS_TOKEN, platform: 'ios', topics: ['news'], channel: 'beta' }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      deviceId: 'device-1',
      created: true,
    });
    expect(mocks.registerDevice).toHaveBeenCalledWith(
      { appId: APP_ID, organizationId: 'org-1' },
      expect.objectContaining({ token: IOS_TOKEN, platform: 'ios', channel: 'beta' }),
    );
  });

  it('answers 200 for a known device and 202 when push does not accept it', async () => {
    mocks.registerDevice.mockResolvedValueOnce({
      accepted: true,
      deviceId: 'device-9',
      created: false,
    });
    expect((await POST(request('POST', { token: 'fcm:abc', platform: 'android' }))).status).toBe(
      200,
    );
    mocks.registerDevice.mockResolvedValueOnce({ accepted: false, reason: 'device_limit' });
    const limited = await POST(request('POST', { token: IOS_TOKEN, platform: 'ios' }));
    expect(limited.status).toBe(202);
    await expect(limited.json()).resolves.toEqual({ accepted: false, reason: 'device_limit' });
  });

  it('does not store devices while the workspace has the add-on off', async () => {
    mocks.appFindUnique.mockResolvedValue({
      id: APP_ID,
      organizationId: 'org-1',
      organization: { pushEnabled: false },
    });
    const response = await POST(request('POST', { token: IOS_TOKEN, platform: 'ios' }));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: false, reason: 'push_disabled' });
    expect(mocks.registerDevice).not.toHaveBeenCalled();
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
    const response = await DELETE(request('DELETE', { token: IOS_TOKEN }));
    expect(response.status).toBe(200);
    expect(mocks.unregisterDevice).toHaveBeenCalledWith(APP_ID, IOS_TOKEN);
  });
});
