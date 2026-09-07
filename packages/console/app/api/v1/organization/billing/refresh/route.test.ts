import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  isPolarConfigured: vi.fn(),
  refreshBillingState: vi.fn(),
}));
vi.mock('@/lib/session', () => ({ getSessionContext: mocks.getSessionContext }));
vi.mock('@/lib/polar', () => ({ isPolarConfigured: mocks.isPolarConfigured }));
vi.mock('@/lib/billing/service', () => ({ refreshBillingState: mocks.refreshBillingState }));
import { POST } from './route';

function request(organizationId?: string) {
  return new NextRequest('https://console.example/api/v1/organization/billing/refresh', {
    method: 'POST',
    headers: organizationId ? { 'x-otakit-organization-id': organizationId } : {},
  });
}
describe('billing refresh workspace scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPolarConfigured.mockReturnValue(true);
    mocks.getSessionContext.mockResolvedValue({ organizationId: 'org-1' });
    mocks.refreshBillingState.mockResolvedValue({ isActive: true, planKey: 'pro' });
  });
  it('rejects a stale checkout workspace before contacting the billing provider', async () => {
    expect((await POST(request('org-2'))).status).toBe(409);
    expect(mocks.refreshBillingState).not.toHaveBeenCalled();
  });
  it.each([undefined, 'org-1'])(
    'refreshes the resolved workspace with expected scope %s',
    async (expected) => {
      const response = await POST(request(expected));
      expect(response.status).toBe(200);
      expect(mocks.refreshBillingState).toHaveBeenCalledWith('org-1');
      expect(await response.json()).toEqual({ billing: { isActive: true, planKey: 'pro' } });
    },
  );
  it('requires authentication', async () => {
    mocks.getSessionContext.mockResolvedValue(null);
    expect((await POST(request('org-1'))).status).toBe(401);
    expect(mocks.refreshBillingState).not.toHaveBeenCalled();
  });
  it('does not confirm a plan when the billing provider fails', async () => {
    mocks.refreshBillingState.mockRejectedValue(new Error('Unavailable'));
    expect((await POST(request('org-1'))).status).toBe(502);
  });
});
