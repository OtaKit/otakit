import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onPayload: null as null | ((payload: { type: string; data: unknown }) => Promise<void>),
  refreshBillingState: vi.fn(),
  applyCreditOrder: vi.fn(),
  refreshUsageAfterCreditChange: vi.fn(),
}));
vi.mock('@polar-sh/nextjs', () => ({
  Webhooks: (options: { onPayload: typeof mocks.onPayload }) => {
    mocks.onPayload = options.onPayload;
    return async () => new Response(null, { status: 202 });
  },
}));
vi.mock('@/lib/polar', () => ({ isPolarConfigured: () => true }));
vi.mock('@/lib/billing/service', () => ({ refreshBillingState: mocks.refreshBillingState }));
vi.mock('@/lib/billing/credits', () => ({ applyCreditOrder: mocks.applyCreditOrder }));
vi.mock('@/lib/billing/usage', () => ({
  refreshUsageAfterCreditChange: mocks.refreshUsageAfterCreditChange,
}));
vi.stubEnv('POLAR_WEBHOOK_SECRET', 'whsec_test');

await import('./route');

function deliver(type: string, data: unknown) {
  if (!mocks.onPayload) throw new Error('webhook handler not registered');
  return mocks.onPayload({ type, data });
}

describe('Polar webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    mocks.applyCreditOrder.mockResolvedValue({ organizationId: 'org-1', changed: true });
  });

  it.each(['order.paid', 'order.refunded'])(
    'applies %s to the credit ledger and recounts usage',
    async (type) => {
      const order = { id: 'order-1' };
      await deliver(type, order);
      expect(mocks.applyCreditOrder).toHaveBeenCalledWith(order);
      expect(mocks.refreshUsageAfterCreditChange).toHaveBeenCalledWith('org-1');
      expect(mocks.refreshBillingState).not.toHaveBeenCalled();
    },
  );

  it('recounts usage for an order that was already applied', async () => {
    mocks.applyCreditOrder.mockResolvedValue({ organizationId: 'org-1', changed: false });
    await deliver('order.paid', { id: 'order-1' });
    expect(mocks.refreshUsageAfterCreditChange).toHaveBeenCalledWith('org-1');
  });

  it('skips orders that are not credit packs', async () => {
    mocks.applyCreditOrder.mockResolvedValue(null);
    await deliver('order.paid', { id: 'order-subscription' });
    expect(mocks.refreshUsageAfterCreditChange).not.toHaveBeenCalled();
  });

  it('lets a failed grant throw so Polar retries the delivery', async () => {
    mocks.applyCreditOrder.mockRejectedValue(new Error('database down'));
    await expect(deliver('order.paid', { id: 'order-1' })).rejects.toThrow('database down');
  });

  it('still refreshes the billing state for subscription events', async () => {
    await deliver('subscription.active', { customer: { externalId: 'organization:org-2' } });
    expect(mocks.refreshBillingState).toHaveBeenCalledWith('org-2');
    expect(mocks.applyCreditOrder).not.toHaveBeenCalled();
  });
});
