import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ listRecentAppEventsWithStatus: vi.fn() }));

vi.mock('@/lib/tinybird/events', () => ({
  listRecentAppEventsWithStatus: mocks.listRecentAppEventsWithStatus,
}));

import { listEvents } from './events';

describe('event service', () => {
  beforeEach(() => vi.resetAllMocks());

  it('preserves requested detail and labels it as untrusted client data', async () => {
    mocks.listRecentAppEventsWithStatus.mockResolvedValue({
      available: true,
      data: [
        {
          id: 'event-1',
          appId: 'app-1',
          action: 'download_error',
          platform: 'ios',
          detail: 'Network request failed',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await listEvents({
      appId: 'app-1',
      from: new Date('2026-01-01'),
      limit: 50,
      includeDetail: true,
    });

    expect(result.analyticsAvailable).toBe(true);
    expect(result.events[0]).toMatchObject({
      detail: 'Network request failed',
      dataTrust: 'client_reported_untrusted_text',
    });
  });

  it('distinguishes unavailable analytics from an authoritative empty result', async () => {
    mocks.listRecentAppEventsWithStatus.mockResolvedValue({ available: false, data: [] });

    const result = await listEvents({
      appId: 'app-1',
      from: new Date('2026-01-01'),
      limit: 50,
    });

    expect(result).toEqual({ events: [], analyticsAvailable: false });
  });

  it('keeps explicit null channel and runtime filters scoped to the base/default lane', async () => {
    mocks.listRecentAppEventsWithStatus.mockResolvedValue({ available: true, data: [] });

    await listEvents({
      appId: 'app-1',
      from: new Date('2026-01-01'),
      limit: 50,
      channel: null,
      runtimeVersion: null,
    });

    expect(mocks.listRecentAppEventsWithStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: undefined,
        channelIsNull: true,
        runtimeVersion: undefined,
        runtimeVersionIsNull: true,
      }),
    );
  });

  it('does not confuse a named base channel with the unnamed base channel', async () => {
    mocks.listRecentAppEventsWithStatus.mockResolvedValue({ available: true, data: [] });

    await listEvents({
      appId: 'app-1',
      from: new Date('2026-01-01'),
      limit: 50,
      channel: 'base',
    });

    expect(mocks.listRecentAppEventsWithStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'base',
        channelIsNull: false,
      }),
    );
  });
});
