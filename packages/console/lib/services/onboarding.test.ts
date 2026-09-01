import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceEvent, DeviceEventAction } from '@/app/components/dashboard-types';

const mocks = vi.hoisted(() => ({
  findApp: vi.fn(),
  countConsents: vi.fn(),
  findAuditEntries: vi.fn(),
  findBundle: vi.fn(),
  findRelease: vi.fn(),
  listEvents: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    app: { findFirst: mocks.findApp },
    oauthConsent: { count: mocks.countConsents },
    auditLog: { findMany: mocks.findAuditEntries },
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
  return {
    id: 'release-1',
    channel: null,
    promotedAt,
    bundle: { runtimeVersion: '2026.04' },
  };
}

async function snapshot() {
  return getOnboardingSnapshot({ organizationId: 'org-1', userId: 'user-1', now: NOW });
}

describe('onboarding snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TINYBIRD_READ_TOKEN', 'read-token');
    vi.stubEnv('TINYBIRD_API_HOST', 'https://api.tinybird.test');
    mocks.findApp.mockResolvedValue(null);
    mocks.countConsents.mockResolvedValue(0);
    mocks.findAuditEntries.mockResolvedValue([]);
    mocks.findBundle.mockResolvedValue(null);
    mocks.findRelease.mockResolvedValue(null);
    mocks.listEvents.mockResolvedValue({ data: [], available: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('starts a brand-new organization with nothing claimed as done', async () => {
    const result = await snapshot();

    expect(result.complete).toBe(false);
    expect(result.completedCount).toBe(0);
    expect(result.app).toBeNull();
    expect(result.steps.agent.status).toBe('todo');
    expect(result.steps.device.status).toBe('todo');
    // Nothing is published, so there is nothing to diagnose yet.
    expect(result.steps.device.diagnosis).toBeNull();
  });

  it('names the missing notifyAppReady() call when a device reports notify_timeout', async () => {
    mocks.findApp.mockResolvedValue(APP);
    mocks.findBundle.mockResolvedValue({ version: '1.0.1', createdAt: NOW });
    mocks.findRelease.mockResolvedValue(publishedRelease());
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
    mocks.findApp.mockResolvedValue(APP);
    mocks.findBundle.mockResolvedValue({ version: '1.0.1', createdAt: NOW });
    mocks.findRelease.mockResolvedValue(publishedRelease());
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
    mocks.findApp.mockResolvedValue(APP);
    mocks.findBundle.mockResolvedValue({ version: '1.0.1', createdAt: NOW });

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
    mocks.findApp.mockResolvedValue(APP);
    mocks.findAuditEntries.mockResolvedValue([
      { actorType: 'user', metadata: { mcp: { clientName: 'Claude Code' } } },
    ]);
    mocks.findBundle.mockResolvedValue({ version: '1.0.1', createdAt: NOW });
    mocks.findRelease.mockResolvedValue(publishedRelease());
    mocks.listEvents.mockResolvedValue({
      data: [event('applied'), event('downloaded')],
      available: true,
    });

    const result = await snapshot();

    expect(result.complete).toBe(true);
    expect(result.completedCount).toBe(5);
    expect(result.steps.device.status).toBe('done');
    expect(result.steps.device.diagnosis).toBeNull();
    expect(result.steps.device.bundleVersion).toBe('1.0.1');
    expect(result.steps.device.platform).toBe('ios');
    expect(result.steps.agent.clientName).toBe('Claude Code');
  });

  it('lets setup finish on a deployment with no analytics backend', async () => {
    vi.stubEnv('TINYBIRD_READ_TOKEN', '');
    mocks.findApp.mockResolvedValue(APP);
    mocks.findAuditEntries.mockResolvedValue([{ actorType: 'key', metadata: null }]);
    mocks.findBundle.mockResolvedValue({ version: '1.0.1', createdAt: NOW });
    mocks.findRelease.mockResolvedValue(publishedRelease());

    const result = await snapshot();

    // Unverifiable is not the same as failed: the guide must not strand a
    // self-hosted user on a step it can never observe.
    expect(result.analyticsAvailable).toBe(false);
    expect(result.steps.device.status).toBe('unknown');
    expect(result.steps.device.diagnosis?.code).toBe('analytics_unavailable');
    expect(result.complete).toBe(true);
    expect(mocks.listEvents).not.toHaveBeenCalled();
  });

  it('prefers a real MCP connection over an inferred one', async () => {
    vi.stubEnv('OTAKIT_REMOTE_MCP_ENABLED', 'true');
    vi.stubEnv('OTAKIT_REMOTE_MCP_OAUTH_ENABLED', 'true');
    mocks.countConsents.mockResolvedValue(1);
    mocks.findAuditEntries.mockResolvedValue([{ actorType: 'key', metadata: null }]);

    expect((await snapshot()).steps.agent.evidence).toBe('oauth');
  });

  it('falls back to an organization key as the weakest agent evidence', async () => {
    mocks.findAuditEntries.mockResolvedValue([{ actorType: 'key', metadata: null }]);

    const result = await snapshot();

    expect(result.steps.agent.evidence).toBe('assumed');
    expect(result.steps.agent.status).toBe('done');
  });
});
