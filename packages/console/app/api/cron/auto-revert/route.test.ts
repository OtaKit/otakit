import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runAutoRevertSweep: vi.fn(),
  deliverPendingAutoRevertAlerts: vi.fn(),
  reconcilePendingReleaseMutations: vi.fn(),
}));

vi.mock('@/lib/auto-revert', () => ({ runAutoRevertSweep: mocks.runAutoRevertSweep }));
vi.mock('@/lib/auto-revert-alerts', () => ({
  deliverPendingAutoRevertAlerts: mocks.deliverPendingAutoRevertAlerts,
}));
vi.mock('@/lib/services/releases', () => ({
  reconcilePendingReleaseMutations: mocks.reconcilePendingReleaseMutations,
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
    mocks.deliverPendingAutoRevertAlerts.mockResolvedValue({ checked: 0, sent: 0, pending: 0 });
    mocks.reconcilePendingReleaseMutations.mockResolvedValue({
      checked: 2,
      repaired: 2,
      pending: 0,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllEnvs());

  it('reports each repair alongside the sweep when everything succeeds', async () => {
    const payload = await (await POST(request() as never)).json();

    expect(mocks.runAutoRevertSweep).toHaveBeenCalledOnce();
    expect(payload.manifestRepairs).toEqual({ checked: 2, repaired: 2, pending: 0 });
    expect(payload.failures).toBeUndefined();
  });

  it('still runs the sweep when a reliability repair throws', async () => {
    // Auto-revert is the safety net for a bad rollout. A poisoned mutation row
    // must not take the sweep down with it.
    mocks.reconcilePendingReleaseMutations.mockRejectedValue(new Error('poisoned row'));
    mocks.deliverPendingAutoRevertAlerts.mockRejectedValue(new Error('smtp down'));

    const response = await POST(request() as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.runAutoRevertSweep).toHaveBeenCalledOnce();
    expect(payload.failures).toEqual(['manifestRepairs', 'recoveredAlerts']);
  });

  it('skips both repairs while the reliability flag is off', async () => {
    vi.stubEnv('OTAKIT_RELEASE_RELIABILITY_ENABLED', 'false');

    await POST(request() as never);

    expect(mocks.reconcilePendingReleaseMutations).not.toHaveBeenCalled();
    expect(mocks.deliverPendingAutoRevertAlerts).not.toHaveBeenCalled();
    expect(mocks.runAutoRevertSweep).toHaveBeenCalledOnce();
  });
});
