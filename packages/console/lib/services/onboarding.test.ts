import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceEvent, DeviceEventAction } from '@/app/components/dashboard-types';

const mocks = vi.hoisted(() => ({
  findApp: vi.fn(),
  findBundle: vi.fn(),
  findRelease: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    app: { findFirst: mocks.findApp },
    bundle: { findFirst: mocks.findBundle },
    release: { findFirst: mocks.findRelease },
  },
}));
vi.mock('@/lib/tinybird/events', () => ({
  listRecentAppEventsWithStatus: mocks.listEvents,
}));

import { getOnboardingSnapshot } from './onboarding';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const APP = { id: 'app-1', slug: 'com.acme.shop', createdAt: new Date('2026-09-01T00:00:00.000Z') };

function event(action: DeviceEventAction, detail: string | null = null): DeviceEvent {
  return {
    id: `event-${action}-${detail ?? 'none'}`,
    appId: APP.id,
    action,
    platform: 'ios',
    bundleVersion: '1.0.1',
    channel: null,
    runtimeVersion: '2026.04',
    detail,
    createdAt: '2026-09-02T11:59:00.000Z',
  };
}

/** A release published far enough back that the device grace window has passed. */
function publishedRelease(promotedAt = new Date('2026-09-02T11:00:00.000Z')) {
  return { id: 'release-1', channel: null, promotedAt, bundle: { runtimeVersion: '2026.04' } };
}

/** Everything up to the device step already done. */
function throughRelease() {
  mocks.findApp.mockResolvedValue(APP);
  mocks.findBundle.mockResolvedValue({ version: '1.0.1', createdAt: NOW });
  mocks.findRelease.mockResolvedValue(publishedRelease());
}

async function snapshot() {
  return getOnboardingSnapshot({ organizationId: 'org-1', now: NOW });
}

describe('onboarding snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TINYBIRD_READ_TOKEN', 'read-token');
    vi.stubEnv('TINYBIRD_API_HOST', 'https://api.tinybird.test');
    mocks.findApp.mockResolvedValue(null);
    mocks.findBundle.mockResolvedValue(null);
    mocks.findRelease.mockResolvedValue(null);
    mocks.listEvents.mockResolvedValue({ data: [], available: true });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('tracks only checkpoints the server can prove', async () => {
    const result = await snapshot();

    // Connecting a CLI or an agent is not among them: `otakit login` stores a
    // user session token, so its writes are indistinguishable from console
    // clicks. Four steps, every one of them verifiable.
    expect(result.totalCount).toBe(4);
    expect(Object.keys(result.steps)).toEqual(['app', 'bundle', 'release', 'device']);
    expect(result.completedCount).toBe(0);
    expect(result.complete).toBe(false);
    expect(result.steps.app.status).toBe('active');
    expect(result.steps.device.diagnosis).toBeNull();
  });

  it('names the missing notifyAppReady() call when a device reports notify_timeout', async () => {
    throughRelease();
    mocks.listEvents.mockResolvedValue({
      data: [event('rollback', 'notify_timeout'), event('downloaded')],
      available: true,
    });

    const result = await snapshot();

    expect(result.steps.device.status).toBe('blocked');
    expect(result.steps.device.diagnosis).toMatchObject({
      code: 'notify_timeout',
      tone: 'error',
      detail: 'notify_timeout',
    });
    expect(result.steps.device.diagnosis?.title).toContain('notifyAppReady');
    expect(result.steps.device.diagnosis?.fixPrompt).toBeTruthy();
    expect(result.complete).toBe(false);
  });

  it('distinguishes a failed download from a rollback', async () => {
    throughRelease();
    mocks.listEvents.mockResolvedValue({
      data: [event('download_error', 'http_403')],
      available: true,
    });

    const result = await snapshot();

    expect(result.steps.device.diagnosis?.code).toBe('download_error');
    expect(result.steps.device.diagnosis?.detail).toBe('http_403');
    expect(result.steps.device.diagnosis?.causes?.length).toBeGreaterThan(0);
  });

  it('blames the silence on configuration only once the grace window has passed', async () => {
    throughRelease();

    mocks.findRelease.mockResolvedValue(publishedRelease(new Date(NOW.getTime() - 30_000)));
    expect((await snapshot()).steps.device.diagnosis?.code).toBe('waiting_for_device');

    mocks.findRelease.mockResolvedValue(publishedRelease(new Date(NOW.getTime() - 10 * 60_000)));
    const stale = await snapshot();
    expect(stale.steps.device.diagnosis?.code).toBe('no_device_contact');
    expect(stale.steps.device.status).toBe('blocked');
    expect(stale.steps.device.diagnosis?.causes).toContain(
      'plugins.OtaKit.appId does not match this app',
    );
  });

  it('completes on an applied event and reports what landed', async () => {
    throughRelease();
    mocks.listEvents.mockResolvedValue({
      data: [event('applied'), event('downloaded')],
      available: true,
    });

    const result = await snapshot();

    expect(result.complete).toBe(true);
    expect(result.completedCount).toBe(4);
    expect(result.steps.device.status).toBe('done');
    expect(result.steps.device.diagnosis).toBeNull();
    expect(result.steps.device.bundleVersion).toBe('1.0.1');
    expect(result.steps.device.platform).toBe('ios');
  });

  it('lets setup finish on a deployment with no analytics backend', async () => {
    vi.stubEnv('TINYBIRD_READ_TOKEN', '');
    throughRelease();

    const result = await snapshot();

    // Unverifiable is not the same as failed: the checklist must not strand a
    // self-hosted user on a step it can never observe.
    expect(result.analyticsAvailable).toBe(false);
    expect(result.steps.device.status).toBe('unknown');
    expect(result.steps.device.diagnosis?.code).toBe('analytics_unavailable');
    expect(result.complete).toBe(true);
    expect(mocks.listEvents).not.toHaveBeenCalled();
  });
});
