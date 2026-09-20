import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./client', () => ({
  TinybirdConfigError: class extends Error {},
  isTinybirdConfigured: () => true,
  warnTinybirdNotConfigured: vi.fn(),
  queryTinybirdPipe: mocks.query,
}));
import { listRecentAppEventsWithStatus } from './events';

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
