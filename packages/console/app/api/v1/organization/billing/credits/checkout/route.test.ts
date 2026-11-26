import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  findUnique: vi.fn(),
  createCheckout: vi.fn(),
  isPolarConfigured: vi.fn(),
  creditPackProductId: vi.fn(),
}));
vi.mock('@/lib/session', () => ({ getSessionContext: mocks.getSessionContext }));
vi.mock('@/lib/db', () => ({ db: { organization: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/polar', () => ({
  isPolarConfigured: mocks.isPolarConfigured,
  getPolar: () => ({ checkouts: { create: mocks.createCheckout } }),
}));
vi.mock('@/lib/billing/config', () => ({
  creditPackProductId: mocks.creditPackProductId,
  getExternalCustomerId: (id: string) => `organization:${id}`,
}));
import { POST } from './route';

function request(body: unknown, organizationId = 'org-1') {
  return new NextRequest('https://console.example/api/v1/organization/billing/credits/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-otakit-organization-id': organizationId },
    body: JSON.stringify(body),
  });
}

describe('extra downloads checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPolarConfigured.mockReturnValue(true);
    mocks.getSessionContext.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
      email: 'user@example.test',
      role: 'owner',
    });
    mocks.findUnique.mockResolvedValue({ planKey: 'free' });
    mocks.creditPackProductId.mockImplementation((key: string) => `product-${key}`);
    mocks.createCheckout.mockResolvedValue({ url: 'https://checkout.example/session' });
  });

  it.each([
    ['free', 'downloads_5k'],
    ['starter', 'downloads_100k'],
    ['pro', 'downloads_1m'],
  ])('sells the %s plan its own pack', async (planKey, pack) => {
    mocks.findUnique.mockResolvedValue({ planKey });
    const response = await POST(request({ pack }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ checkoutUrl: 'https://checkout.example/session' });
    expect(mocks.createCheckout).toHaveBeenCalledWith({
      products: [`product-${pack}`],
      externalCustomerId: 'organization:org-1',
      customerEmail: 'user@example.test',
      successUrl:
        'https://console.example/dashboard/settings?credits=success&credits_org=org-1&checkout_id={CHECKOUT_ID}',
      returnUrl: 'https://console.example/dashboard/settings',
      metadata: { organizationId: 'org-1', initiatedByUserId: 'user-1', creditPack: pack },
    });
  });

  it('refuses a pack shown for a plan the workspace no longer has', async () => {
    mocks.findUnique.mockResolvedValue({ planKey: 'starter' });
    expect((await POST(request({ pack: 'downloads_5k' }))).status).toBe(409);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it('has no pack for Enterprise', async () => {
    mocks.findUnique.mockResolvedValue({ planKey: 'enterprise' });
    expect((await POST(request({ pack: 'downloads_1m' }))).status).toBe(400);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it.each([{}, { pack: 'downloads_50k' }, null])('rejects an invalid body %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
  });

  it('lets only owners and admins buy', async () => {
    mocks.getSessionContext.mockResolvedValue({ organizationId: 'org-1', role: 'member' });
    expect((await POST(request({ pack: 'downloads_5k' }))).status).toBe(403);
  });

  it('rejects a workspace changed in another tab', async () => {
    expect((await POST(request({ pack: 'downloads_5k' }, 'org-2'))).status).toBe(409);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it('reports a pack product that is not configured', async () => {
    mocks.creditPackProductId.mockReturnValue(null);
    expect((await POST(request({ pack: 'downloads_5k' }))).status).toBe(500);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it('is not found without billing, and retryable when Polar fails', async () => {
    mocks.isPolarConfigured.mockReturnValueOnce(false);
    expect((await POST(request({ pack: 'downloads_5k' }))).status).toBe(404);
    mocks.createCheckout.mockRejectedValueOnce(new Error('polar down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await POST(request({ pack: 'downloads_5k' }))).status).toBe(502);
  });
});
