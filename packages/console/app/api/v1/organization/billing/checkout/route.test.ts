import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  findUnique: vi.fn(),
  createCheckout: vi.fn(),
  isPolarConfigured: vi.fn(),
  planKeyToProductId: vi.fn(),
}));
vi.mock('@/lib/session', () => ({ getSessionContext: mocks.getSessionContext }));
vi.mock('@/lib/db', () => ({ db: { organization: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/polar', () => ({
  isPolarConfigured: mocks.isPolarConfigured,
  getPolar: () => ({ checkouts: { create: mocks.createCheckout } }),
}));
vi.mock('@/lib/billing/config', () => ({
  planKeyToProductId: mocks.planKeyToProductId,
  getExternalCustomerId: (id: string) => `organization:${id}`,
}));
import { POST } from './route';

function request(body: unknown, organizationId = 'org-1') {
  return new NextRequest('https://console.example/api/v1/organization/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-otakit-organization-id': organizationId },
    body: JSON.stringify(body),
  });
}

describe('billing checkout return paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionContext.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
      email: 'user@example.test',
      role: 'owner',
    });
    mocks.findUnique.mockResolvedValue({ isActive: false });
    mocks.isPolarConfigured.mockReturnValue(true);
    mocks.planKeyToProductId.mockReturnValue('product-pro-yearly');
    mocks.createCheckout.mockResolvedValue({ url: 'https://checkout.example/session' });
  });
  it('returns successful and cancelled welcome checkout to the dashboard', async () => {
    const response = await POST(
      request({ planKey: 'pro', interval: 'year', returnTo: 'dashboard' }),
    );
    expect(response.status).toBe(201);
    expect(mocks.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        successUrl: 'https://console.example/dashboard',
        returnUrl: 'https://console.example/dashboard',
        externalCustomerId: 'organization:org-1',
        metadata: expect.objectContaining({ billingInterval: 'year' }),
      }),
    );
  });
  it.each([undefined, 'https://untrusted.example'])(
    'keeps the settings return path for %s',
    async (returnTo) => {
      expect((await POST(request({ planKey: 'starter', returnTo }))).status).toBe(201);
      expect(mocks.createCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          successUrl: 'https://console.example/dashboard/settings?pricing=1&checkout=success',
        }),
      );
      expect(mocks.createCheckout.mock.calls[0][0]).not.toHaveProperty('returnUrl');
    },
  );
  it('rejects a workspace changed in another tab before initiating billing', async () => {
    expect((await POST(request({ planKey: 'pro' }, 'org-2'))).status).toBe(409);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });
  it('does not create a second active subscription', async () => {
    mocks.findUnique.mockResolvedValue({ isActive: true });
    expect((await POST(request({ planKey: 'pro', returnTo: 'dashboard' }))).status).toBe(409);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });
  it('returns a retryable failure when the billing provider is unavailable', async () => {
    mocks.createCheckout.mockRejectedValue(new Error('Provider unavailable'));
    expect((await POST(request({ planKey: 'starter' }))).status).toBe(502);
  });
});
