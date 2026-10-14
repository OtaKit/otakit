import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runAutoRevertSweep: vi.fn(),
  deliverDueNotifications: vi.fn(),
  reconcilePendingReleaseMutations: vi.fn(),
  reconcileRemoteConfigFiles: vi.fn(),
}));

vi.mock('@/lib/auto-revert', () => ({ runAutoRevertSweep: mocks.runAutoRevertSweep }));
vi.mock('@/lib/notifications/deliver', () => ({
  deliverDueNotifications: mocks.deliverDueNotifications,
}));
vi.mock('@/lib/services/releases', () => ({
  reconcilePendingReleaseMutations: mocks.reconcilePendingReleaseMutations,
}));
vi.mock('@/lib/services/remote-config', () => ({
  reconcileRemoteConfigFiles: mocks.reconcileRemoteConfigFiles,
}));

import { POST } from './route';

function request(): Request {
  return new Request('https://console.example/api/cron/auto-revert', { method: 'POST' });
}

describe('auto-revert cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OTAKIT_RELEASE_RELIABILITY_ENABLED', 'true');
    vi.stubEnv('CRON_SECRET', '');
    mocks.runAutoRevertSweep.mockResolvedValue({ reverted: 0 });
    mocks.deliverDueNotifications.mockResolvedValue({ claimed: 1, delivered: 1, failed: 0 });
    mocks.reconcilePendingReleaseMutations.mockResolvedValue({
      checked: 2,
      repaired: 2,
      pending: 0,
    });
    mocks.reconcileRemoteConfigFiles.mockResolvedValue({ checked: 1, repaired: 1, pending: 0 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllEnvs());

  it('reports each repair alongside the sweep when everything succeeds', async () => {
    const payload = await (await POST(request() as never)).json();

    expect(mocks.runAutoRevertSweep).toHaveBeenCalledOnce();
    expect(payload.manifestRepairs).toEqual({ checked: 2, repaired: 2, pending: 0 });
    expect(payload.configRepairs).toEqual({ checked: 1, repaired: 1, pending: 0 });
    expect(payload.notifications).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(mocks.deliverDueNotifications.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.runAutoRevertSweep.mock.invocationCallOrder[0],
    );
    expect(payload.failures).toBeUndefined();
  });

  it('still runs the sweep when a reliability repair throws', async () => {
    // Auto-revert is the safety net for a bad rollout. A poisoned mutation row
    // must not take the sweep down with it.
    mocks.reconcilePendingReleaseMutations.mockRejectedValue(new Error('poisoned row'));
    mocks.deliverDueNotifications.mockRejectedValue(new Error('smtp down'));
    mocks.reconcileRemoteConfigFiles.mockRejectedValue(new Error('r2 down'));

    const response = await POST(request() as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.runAutoRevertSweep).toHaveBeenCalledOnce();
    expect(payload.failures).toEqual(['manifestRepairs', 'configRepairs', 'notifications']);
  });

  it('skips the repair but still delivers while the reliability flag is off', async () => {
    vi.stubEnv('OTAKIT_RELEASE_RELIABILITY_ENABLED', 'false');

    await POST(request() as never);

    expect(mocks.reconcilePendingReleaseMutations).not.toHaveBeenCalled();
    expect(mocks.runAutoRevertSweep).toHaveBeenCalledOnce();
    expect(mocks.deliverDueNotifications).toHaveBeenCalledOnce();
  });
});
