import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), cachedJson: vi.fn() }));
vi.mock('./client', () => ({
  TinybirdConfigError: class extends Error {},
  isTinybirdConfigured: () => true,
  warnTinybirdNotConfigured: vi.fn(),
  queryTinybirdPipe: mocks.query,
}));
vi.mock('@/lib/redis', () => ({ cachedJson: mocks.cachedJson }));
import { getReleaseEventTimeseries, listRecentAppEventsWithStatus } from './events';

const row = {
  event_id: 'event-a',
  app_id: 'app-a',
  action: 'download_error',
  platform: 'android',
  received_at: '2026-09-20T10:00:00Z',
};
const args = { appId: 'app-a', from: new Date('2026-09-01'), limit: 10 };
describe('native context in recent events', () => {
  it('keeps check errors visible without inventing a release association', async () => {
    mocks.query.mockResolvedValue([
      { ...row, action: 'check_error', bundle_version: '', release_id: null, phase: 'signature' },
    ]);
    const result = await listRecentAppEventsWithStatus(args);
    expect(result.data[0]).toMatchObject({
      action: 'check_error',
      bundleVersion: null,
      releaseId: null,
      phase: 'signature',
    });
  });
  beforeEach(() => vi.resetAllMocks());
  it('exposes the native context returned by Tinybird', async () => {
    mocks.query.mockResolvedValue([
      {
        ...row,
        attempt_id: 'bundle-attempt',
        native_sdk_version: '2.3.3',
        phase: 'integrity',
        lifecycle: 'background',
      },
    ]);
    const result = await listRecentAppEventsWithStatus(args);
    expect(result.available).toBe(true);
    expect(result.data[0]).toMatchObject({
      attemptId: 'bundle-attempt',
      nativeSdkVersion: '2.3.3',
      phase: 'integrity',
      lifecycle: 'background',
    });
  });
  it('keeps historical rows usable without context', async () => {
    mocks.query.mockResolvedValue([row]);
    const result = await listRecentAppEventsWithStatus(args);
    expect(result.data[0]).toMatchObject({
      id: 'event-a',
      attemptId: null,
      nativeSdkVersion: null,
      phase: null,
      lifecycle: null,
    });
  });
});

describe('release event timeseries', () => {
  const timeseriesArgs = {
    appId: 'app-a',
    releaseIds: ['release-a', ' release-b ', 'release-a'],
    from: new Date('2026-09-01T00:00:00.000Z'),
    to: new Date('2026-09-02T00:00:00.000Z'),
    daily: false,
    platform: null,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.cachedJson.mockImplementation((_key: string, _ttl: number, load: () => unknown) =>
      load(),
    );
  });

  it('reads buckets through a short cache and converts them', async () => {
    mocks.query.mockResolvedValue([
      {
        release_id: 'release-a',
        action: 'applied',
        bucket_start: 1788220800,
        events_count: '12',
        last_received_at: 1788221000,
      },
      { release_id: 'release-a', action: 'check_error', bucket_start: 1788220800 },
      { release_id: '', action: 'applied', bucket_start: 1788220800 },
    ]);
    const result = await getReleaseEventTimeseries(timeseriesArgs);

    const params = {
      app_id: 'app-a',
      release_ids: 'release-a,release-b',
      from_ts: '2026-09-01T00:00:00.000Z',
      to_ts: '2026-09-02T00:00:00.000Z',
      platform: '',
    };
    expect(mocks.query).toHaveBeenCalledWith('release_event_timeseries', params);
    expect(mocks.cachedJson).toHaveBeenCalledWith(
      `tinybird:release_event_timeseries:${JSON.stringify(params)}`,
      60,
      expect.any(Function),
    );
    expect(result).toEqual({
      available: true,
      data: [
        {
          releaseId: 'release-a',
          action: 'applied',
          bucketStart: 1788220800000,
          count: 12,
          lastReceivedAt: 1788221000000,
        },
      ],
    });
  });

  it('asks for daily buckets and a platform only when set', async () => {
    mocks.query.mockResolvedValue([]);
    await getReleaseEventTimeseries({ ...timeseriesArgs, daily: true, platform: 'ios' });
    expect(mocks.query).toHaveBeenCalledWith(
      'release_event_timeseries',
      expect.objectContaining({ daily: 1, platform: 'ios' }),
    );
  });

  it('reports a failed read as unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.query.mockRejectedValue(new Error('Tinybird pipe failed with 404'));
    await expect(getReleaseEventTimeseries(timeseriesArgs)).resolves.toEqual({
      data: [],
      available: false,
    });
  });
});
