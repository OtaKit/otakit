import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  isPolarConfigured: vi.fn(),
  checkRateLimit: vi.fn(),
  syncCreditOrders: vi.fn(),
  refreshUsageAfterCreditChange: vi.fn(),
  getOrganizationUsageSnapshot: vi.fn(),
  getOrganizationEntitlements: vi.fn(),
  getPurchasableCreditPack: vi.fn(),
}));
vi.mock('@/lib/session', () => ({ getSessionContext: mocks.getSessionContext }));
vi.mock('@/lib/polar', () => ({ isPolarConfigured: mocks.isPolarConfigured }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock('@/lib/billing/credits', () => ({ syncCreditOrders: mocks.syncCreditOrders }));
vi.mock('@/lib/billing/service', () => ({
  getOrganizationEntitlements: mocks.getOrganizationEntitlements,
}));
vi.mock('@/lib/billing/config', () => ({
  getPurchasableCreditPack: mocks.getPurchasableCreditPack,
}));
vi.mock('@/lib/billing/usage', () => ({
  refreshUsageAfterCreditChange: mocks.refreshUsageAfterCreditChange,
  getOrganizationUsageSnapshot: mocks.getOrganizationUsageSnapshot,
}));
import { POST } from './route';

const PACK = { key: 'downloads_5k', planKey: 'free', downloads: 5_000, priceCents: 500 };

function request(body: unknown, organizationId = 'org-1') {
  return new NextRequest('https://console.example/api/v1/organization/billing/credits/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-otakit-organization-id': organizationId },
    body: JSON.stringify(body),
  });
}

describe('extra downloads purchase confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPolarConfigured.mockReturnValue(true);
    mocks.getSessionContext.mockResolvedValue({ organizationId: 'org-1', role: 'admin' });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.syncCreditOrders.mockResolvedValue({
      changed: false,
      paidCheckoutIds: new Set(['checkout-1']),
    });
    mocks.refreshUsageAfterCreditChange.mockResolvedValue({ creditsRemaining: 5_000 });
    mocks.getOrganizationUsageSnapshot.mockResolvedValue({ creditsRemaining: 4_000 });
    mocks.getOrganizationEntitlements.mockResolvedValue({ planKey: 'free' });
    mocks.getPurchasableCreditPack.mockReturnValue(PACK);
  });

  it('confirms a checkout the webhook already applied', async () => {
    const response = await POST(request({ checkoutId: 'checkout-1' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      changed: false,
      confirmed: true,
      usage: { creditsRemaining: 4_000 },
      creditPack: PACK,
    });
    expect(mocks.getPurchasableCreditPack).toHaveBeenCalledWith('free');
    expect(mocks.refreshUsageAfterCreditChange).not.toHaveBeenCalled();
  });

  it('recounts usage when the sync applied a new order', async () => {
    mocks.syncCreditOrders.mockResolvedValue({
      changed: true,
      paidCheckoutIds: new Set(['checkout-2']),
    });
    const body = await (await POST(request({ checkoutId: 'checkout-2' }))).json();
    expect(body).toEqual({
      changed: true,
      confirmed: true,
      usage: { creditsRemaining: 5_000 },
      creditPack: PACK,
    });
  });

  it('keeps an unpaid checkout pending', async () => {
    const body = await (await POST(request({ checkoutId: 'checkout-9' }))).json();
    expect(body.confirmed).toBe(false);
  });

  it('ignores a malformed checkout id', async () => {
    const body = await (await POST(request({ checkoutId: 'a b/c' }))).json();
    expect(body.confirmed).toBe(false);
  });

  it('checks the workspace, role and rate limit before calling Polar', async () => {
    expect((await POST(request({}, 'org-2'))).status).toBe(409);
    mocks.getSessionContext.mockResolvedValueOnce({ organizationId: 'org-1', role: 'member' });
    expect((await POST(request({}))).status).toBe(403);
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false });
    expect((await POST(request({}))).status).toBe(429);
    expect(mocks.syncCreditOrders).not.toHaveBeenCalled();
  });

  it('returns a retryable error when Polar fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.syncCreditOrders.mockRejectedValue(new Error('polar down'));
    expect((await POST(request({ checkoutId: 'checkout-1' }))).status).toBe(502);
  });
});
