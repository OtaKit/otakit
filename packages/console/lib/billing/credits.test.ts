import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/polar', () => ({ isPolarConfigured: () => true, getPolar: vi.fn() }));

import type { Order } from '@polar-sh/sdk/models/components/order.js';

import { organizationIdForOrder, refundedDownloadsShare } from './credits';

function order(fields: { metadata?: Record<string, unknown>; externalId?: string | null }): Order {
  return {
    id: 'order-1',
    metadata: fields.metadata ?? {},
    customer: { externalId: fields.externalId ?? null },
  } as unknown as Order;
}

describe('organizationIdForOrder', () => {
  it('uses the workspace stored on the checkout', () => {
    expect(
      organizationIdForOrder(
        order({ metadata: { organizationId: 'org-b' }, externalId: 'organization:org-b' }),
      ),
    ).toBe('org-b');
  });

  it('prefers the checkout over a customer that belongs to another workspace', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      organizationIdForOrder(
        order({ metadata: { organizationId: 'org-b' }, externalId: 'organization:org-a' }),
      ),
    ).toBe('org-b');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('falls back to the customer, and to null without either', () => {
    expect(organizationIdForOrder(order({ externalId: 'organization:org-a' }))).toBe('org-a');
    expect(organizationIdForOrder(order({ metadata: { organizationId: 7 } }))).toBeNull();
    expect(organizationIdForOrder(order({}))).toBeNull();
  });
});

describe('refundedDownloadsShare', () => {
  const pack = { downloads: 5_000, amountCents: 500 };

  it('takes back the refunded share of the pack', () => {
    expect(refundedDownloadsShare({ ...pack, previousRefundedCents: 0, refundedCents: 500 })).toBe(
      5_000,
    );
    expect(refundedDownloadsShare({ ...pack, previousRefundedCents: 0, refundedCents: 250 })).toBe(
      2_500,
    );
  });

  it('adds partial refunds up without rounding drift', () => {
    const odd = { downloads: 100_000, amountCents: 999 };
    let previous = 0;
    let total = 0;
    for (const refunded of [333, 666, 999]) {
      total += refundedDownloadsShare({
        ...odd,
        previousRefundedCents: previous,
        refundedCents: refunded,
      });
      previous = refunded;
    }
    expect(total).toBe(100_000);
  });

  it('ignores repeated, lower and free-order refunds', () => {
    expect(
      refundedDownloadsShare({ ...pack, previousRefundedCents: 250, refundedCents: 250 }),
    ).toBe(0);
    expect(
      refundedDownloadsShare({ ...pack, previousRefundedCents: 250, refundedCents: 100 }),
    ).toBe(0);
    expect(
      refundedDownloadsShare({
        downloads: 5_000,
        amountCents: 0,
        previousRefundedCents: 0,
        refundedCents: 0,
      }),
    ).toBe(0);
  });

  it('never takes back more than the pack', () => {
    expect(refundedDownloadsShare({ ...pack, previousRefundedCents: 0, refundedCents: 900 })).toBe(
      5_000,
    );
  });
});
