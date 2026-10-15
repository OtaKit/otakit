import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  getConfig: vi.fn(),
  refreshConfig: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => native,
}));

const { OtaKit } = await import('./index');

const remote = {
  valuesJson: '{"checkoutEnabled":false,"helpUrl":"https://example.com/help"}',
  experimentsJson: null,
  version: 12,
  channel: 'production',
  fetchedAt: '2026-10-14T09:00:00.000Z',
  source: 'remote' as const,
};

describe('remote config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('merges remote values over the defaults', async () => {
    native.getConfig.mockResolvedValue(remote);
    await expect(
      OtaKit.getConfig({ defaults: { checkoutEnabled: true, maxItems: 5 } }),
    ).resolves.toEqual({
      values: { checkoutEnabled: false, maxItems: 5, helpUrl: 'https://example.com/help' },
      version: 12,
      channel: 'production',
      source: 'remote',
      fetchedAt: '2026-10-14T09:00:00.000Z',
    });
  });

  it('reports a saved config as cache, and no config as defaults', async () => {
    native.getConfig.mockResolvedValueOnce({ ...remote, source: 'cache', channel: null });
    await expect(OtaKit.getConfig()).resolves.toMatchObject({ source: 'cache', channel: null });

    native.getConfig.mockResolvedValueOnce({
      valuesJson: null,
      experimentsJson: null,
      version: null,
      channel: null,
      fetchedAt: null,
      source: 'none',
    });
    await expect(OtaKit.getConfig({ defaults: { a: 1 } })).resolves.toEqual({
      values: { a: 1 },
      version: null,
      channel: null,
      source: 'defaults',
      fetchedAt: null,
    });
  });

  it('treats values that are not a JSON object as no remote config', async () => {
    for (const valuesJson of ['not json', '[1,2]', 'null']) {
      native.getConfig.mockResolvedValueOnce({ ...remote, valuesJson });
      await expect(OtaKit.getConfig({ defaults: { a: 1 } })).resolves.toMatchObject({
        values: { a: 1 },
        source: 'defaults',
      });
    }
  });

  it('uses the defaults when the native plugin is older than 3.4', async () => {
    const unimplemented = Object.assign(
      new Error('"OtaKit.getConfig()" is not implemented on ios'),
      {
        code: 'UNIMPLEMENTED',
      },
    );
    native.getConfig.mockRejectedValue(unimplemented);
    native.refreshConfig.mockRejectedValue(unimplemented);
    await expect(OtaKit.getConfig({ defaults: { a: 1 } })).resolves.toMatchObject({
      values: { a: 1 },
      source: 'defaults',
    });
    await expect(OtaKit.refreshConfig({ defaults: { a: 1 } })).resolves.toMatchObject({
      values: { a: 1 },
      source: 'defaults',
    });
    // Other failures are not hidden.
    native.getConfig.mockRejectedValueOnce(new Error('appId is not configured'));
    await expect(OtaKit.getConfig()).rejects.toThrow('appId is not configured');
  });

  it('passes the refresh error through with the saved config', async () => {
    native.refreshConfig.mockResolvedValue({ ...remote, source: 'cache', error: 'network_error' });
    await expect(OtaKit.refreshConfig({ defaults: { maxItems: 5 } })).resolves.toMatchObject({
      values: { checkoutEnabled: false, maxItems: 5 },
      source: 'cache',
      error: 'network_error',
    });
  });

  it('turns configChanged events into config objects', async () => {
    native.addListener.mockResolvedValue({ remove: vi.fn() });
    const listener = vi.fn();
    await OtaKit.addListener('configChanged', listener);
    const [eventName, forward] = native.addListener.mock.calls[0];
    expect(eventName).toBe('configChanged');
    forward(remote);
    expect(listener).toHaveBeenCalledWith({
      values: { checkoutEnabled: false, helpUrl: 'https://example.com/help' },
      version: 12,
      channel: 'production',
      source: 'remote',
      fetchedAt: '2026-10-14T09:00:00.000Z',
    });

    // Other events pass through untouched.
    const updates = vi.fn();
    await OtaKit.addListener('updateApplied', updates);
    expect(native.addListener.mock.calls[1][1]).toBe(updates);
  });
});
