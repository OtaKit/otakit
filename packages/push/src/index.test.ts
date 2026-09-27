import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  platform: 'ios',
  otakitAvailable: true,
  getChannel: vi.fn(),
  getState: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => native.platform,
    isNativePlatform: () => native.platform !== 'web',
    isPluginAvailable: (name: string) => name === 'OtaKit' && native.otakitAvailable,
  },
  registerPlugin: () => ({ getChannel: native.getChannel, getState: native.getState }),
}));

import { OtaKitPush, resetOtaKitPushForTests } from './index';

const TOKEN = 'ab'.repeat(32);

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe('OtaKitPush', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, created: true, deviceId: 'd1' }), {
        status: 201,
      }),
    );
    native.platform = 'ios';
    native.otakitAvailable = true;
    native.getChannel.mockResolvedValue({ channel: 'beta', source: 'override' });
    native.getState.mockResolvedValue({
      current: { version: '1.4.2', runtimeVersion: '2026.10' },
    });
    resetOtaKitPushForTests();
    OtaKitPush.init({ appId: 'app-1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers the token with platform and OTA context', async () => {
    const result = await OtaKitPush.syncToken(TOKEN, { userId: 'user_1', topics: ['news'] });
    expect(result).toEqual({ status: 'registered' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://console.otakit.app/api/v1/push/devices');
    expect(init.headers).toMatchObject({ 'x-app-id': 'app-1' });
    expect(JSON.parse(init.body)).toMatchObject({
      token: TOKEN,
      platform: 'ios',
      environment: 'production',
      externalUserId: 'user_1',
      topics: ['news'],
      channel: 'beta',
      runtimeVersion: '2026.10',
      bundleVersion: '1.4.2',
    });
  });

  it('does not resend an unchanged token within a day', async () => {
    await OtaKitPush.syncToken(TOKEN);
    const second = await OtaKitPush.syncToken(TOKEN);
    expect(second).toEqual({ status: 'unchanged' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resends when the OTA channel changes', async () => {
    await OtaKitPush.syncToken(TOKEN);
    native.getChannel.mockResolvedValue({ channel: 'production', source: 'config' });
    await OtaKitPush.syncToken(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('works without the OtaKit updater installed', async () => {
    native.otakitAvailable = false;
    await OtaKitPush.syncToken(TOKEN);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      channel: null,
      runtimeVersion: null,
      bundleVersion: null,
    });
  });

  it('keeps the user and topics when subscribing later', async () => {
    await OtaKitPush.syncToken(TOKEN, { userId: 'user_1', topics: ['news'] });
    await OtaKitPush.subscribe('offers');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      externalUserId: 'user_1',
      topics: ['news', 'offers'],
    });
    await expect(OtaKitPush.subscribe('offers')).resolves.toEqual({ status: 'unchanged' });
  });

  it('reports the plan limit without throwing', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ accepted: false, reason: 'device_limit' }), { status: 202 }),
    );
    await expect(OtaKitPush.syncToken(TOKEN)).resolves.toEqual({
      status: 'not_accepted',
      reason: 'device_limit',
    });
  });

  it('does nothing on the web', async () => {
    native.platform = 'web';
    await expect(OtaKitPush.syncToken(TOKEN)).resolves.toEqual({
      status: 'not_accepted',
      reason: 'not_native',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unregisters and forgets the token', async () => {
    await OtaKitPush.syncToken(TOKEN);
    fetchMock.mockResolvedValue(new Response('{"removed":true}', { status: 200 }));
    await OtaKitPush.unregister();
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
    await expect(OtaKitPush.setUser('x')).resolves.toEqual({
      status: 'not_accepted',
      reason: 'no_token_yet',
    });
  });

  it('rejects invalid topics and missing init', async () => {
    await expect(OtaKitPush.syncToken(TOKEN, { topics: ['bad topic'] })).rejects.toThrow(
      /Invalid topic/,
    );
    resetOtaKitPushForTests();
    await expect(OtaKitPush.syncToken(TOKEN)).rejects.toThrow(/init/);
  });
});
