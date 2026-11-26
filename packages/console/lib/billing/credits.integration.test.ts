import { randomUUID } from 'node:crypto';

import type { Order } from '@polar-sh/sdk/models/components/order.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  downloads: new Map<string, number>(),
  // Runs once inside the next download count, to act as a concurrent writer.
  duringCount: null as null | (() => Promise<void>),
  quantities: vi.fn(),
  ingest: vi.fn(),
  listOrders: vi.fn(),
  deleteManifests: vi.fn(),
  restoreManifests: vi.fn(),
  sendUsageWarningEmail: vi.fn(),
}));

vi.mock('@/lib/tinybird/events', () => ({
  getCurrentPeriodDownloadCountFromEvents: async (args: { periodStart: Date }) => {
    const hook = mocks.duringCount;
    mocks.duringCount = null;
    if (hook) await hook();
    return mocks.downloads.get(args.periodStart.toISOString()) ?? 0;
  },
}));
vi.mock('@/lib/polar', () => ({
  isPolarConfigured: () => true,
  getPolar: () => ({
    meters: { quantities: mocks.quantities },
    events: { ingest: mocks.ingest },
    orders: { list: mocks.listOrders },
  }),
}));
vi.mock('@/lib/manifest-files', () => ({
  deleteAllManifestFilesForApp: mocks.deleteManifests,
  restoreManifestFilesForApp: mocks.restoreManifests,
}));
vi.mock('@/lib/email', () => ({ sendUsageWarningEmail: mocks.sendUsageWarningEmail }));
vi.stubEnv('POLAR_PRODUCT_CREDITS_5K', 'product-5k');
vi.stubEnv('POLAR_PRODUCT_CREDITS_100K', 'product-100k');
vi.stubEnv('POLAR_PRODUCT_CREDITS_1M', 'product-1m');
vi.stubEnv('POLAR_METER_DOWNLOADS_ID', 'meter-downloads');

import { db } from '@/lib/db';

import { applyCreditOrder, getCreditPool, syncCreditOrders } from './credits';
import {
  getOrganizationUsageSnapshot,
  refreshOrganizationUsageSnapshot,
  updateOrganizationOverageEnabled,
} from './usage';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

function monthStart(offset = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

function setDownloads(periodStart: Date, count: number) {
  mocks.downloads.set(periodStart.toISOString(), count);
}

function polarOrder(organizationId: string, overrides: Partial<Order> = {}): Order {
  return {
    id: `order-${randomUUID()}`,
    billingReason: 'purchase',
    productId: 'product-5k',
    paid: true,
    netAmount: 500,
    refundedAmount: 0,
    currency: 'usd',
    checkoutId: `checkout-${randomUUID()}`,
    customer: { externalId: `organization:${organizationId}` },
    ...overrides,
  } as unknown as Order;
}

databaseDescribe('extra download credits (PostgreSQL integration)', () => {
  const organizationIds: string[] = [];

  async function createOrganization(data: Record<string, unknown> = {}) {
    const id = randomUUID();
    organizationIds.push(id);
    await db.organization.create({
      data: {
        id,
        name: `Credits ${id}`,
        apps: { create: { id: randomUUID(), slug: `credits.${id}` } },
        ...data,
      },
    });
    return id;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.downloads.clear();
    mocks.duringCount = null;
    mocks.quantities.mockResolvedValue({ total: 0 });
    mocks.ingest.mockResolvedValue({ inserted: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
  });

  it('grants a paid pack once, even when deliveries race', async () => {
    const organizationId = await createOrganization();
    const order = polarOrder(organizationId);

    const results = await Promise.all([applyCreditOrder(order), applyCreditOrder(order)]);
    expect(results.filter((result) => result?.changed)).toHaveLength(1);
    expect(await applyCreditOrder(order)).toEqual({ organizationId, changed: false });
    expect(await getCreditPool(organizationId)).toBe(5_000);
  });

  it('grants the downloads of the product bought, whatever the current plan', async () => {
    const organizationId = await createOrganization({ planKey: 'starter' });
    await applyCreditOrder(
      polarOrder(organizationId, { productId: 'product-1m', netAmount: 5_000 }),
    );
    expect(await getCreditPool(organizationId)).toBe(1_000_000);
  });

  it('ignores orders that are not paid credit packs', async () => {
    const organizationId = await createOrganization();
    expect(await applyCreditOrder(polarOrder(organizationId, { paid: false }))).toBeNull();
    expect(
      await applyCreditOrder(polarOrder(organizationId, { billingReason: 'subscription_cycle' })),
    ).toBeNull();
    expect(
      await applyCreditOrder(polarOrder(organizationId, { productId: 'product-pro-monthly' })),
    ).toBeNull();
    expect(
      await applyCreditOrder(
        polarOrder(organizationId, { customer: { externalId: null } } as Partial<Order>),
      ),
    ).toBeNull();
    expect(await applyCreditOrder(polarOrder(randomUUID()))).toBeNull();
    expect(await getCreditPool(organizationId)).toBe(0);
  });

  it('takes back the refunded share, only from credits that are still unused', async () => {
    const organizationId = await createOrganization();
    const order = polarOrder(organizationId);
    await applyCreditOrder(order);

    // Half refunded: 2,500 of 5,000 taken back, replays change nothing.
    expect(await applyCreditOrder({ ...order, refundedAmount: 250 })).toEqual({
      organizationId,
      changed: true,
    });
    expect(await applyCreditOrder({ ...order, refundedAmount: 250 })).toMatchObject({
      changed: false,
    });
    expect(await getCreditPool(organizationId)).toBe(2_500);

    // A refunded order Polar no longer marks as paid still applies its refund.
    // 2,000 of the rest were spent this month: the full refund takes only 500.
    await db.organization.update({
      where: { id: organizationId },
      data: { usagePeriodStart: monthStart(), creditsUsed: 2_000 },
    });
    await applyCreditOrder({ ...order, refundedAmount: 500, paid: false, status: 'refunded' });
    expect(await getCreditPool(organizationId)).toBe(2_000);
  });

  it('grants and takes back an order first seen after its full refund', async () => {
    const organizationId = await createOrganization();
    const result = await applyCreditOrder(
      polarOrder(organizationId, { paid: false, status: 'refunded', refundedAmount: 500 }),
    );
    expect(result).toEqual({ organizationId, changed: true });
    expect(await getCreditPool(organizationId)).toBe(0);
  });

  it('unblocks a blocked workspace when a pack lands, and blocks again when it is used up', async () => {
    const organizationId = await createOrganization();
    setDownloads(monthStart(), 5_200);

    const blocked = await refreshOrganizationUsageSnapshot(organizationId);
    expect(blocked).toMatchObject({ usageBlocked: true, limit: 5_000, effectiveLimit: 5_000 });
    expect(mocks.deleteManifests).toHaveBeenCalledTimes(1);

    await applyCreditOrder(polarOrder(organizationId));
    const unblocked = await refreshOrganizationUsageSnapshot(organizationId);
    expect(unblocked).toMatchObject({
      usageBlocked: false,
      effectiveLimit: 10_000,
      creditsUsed: 200,
      creditsRemaining: 4_800,
    });
    expect(mocks.restoreManifests).toHaveBeenCalledTimes(1);

    setDownloads(monthStart(), 10_000);
    expect(await refreshOrganizationUsageSnapshot(organizationId)).toMatchObject({
      usageBlocked: true,
      creditsUsed: 5_000,
      creditsRemaining: 0,
    });
  });

  it('retries restoring update manifests when storage failed after a purchase', async () => {
    const organizationId = await createOrganization();
    setDownloads(monthStart(), 5_200);
    await refreshOrganizationUsageSnapshot(organizationId);
    await applyCreditOrder(polarOrder(organizationId));

    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.restoreManifests.mockRejectedValueOnce(new Error('storage down'));
    await expect(refreshOrganizationUsageSnapshot(organizationId)).rejects.toThrow('storage down');
    // Still marked blocked, so the next check sees the change again.
    expect(
      (await db.organization.findUniqueOrThrow({ where: { id: organizationId } })).usageBlocked,
    ).toBe(true);

    expect(await refreshOrganizationUsageSnapshot(organizationId)).toMatchObject({
      usageBlocked: false,
    });
    expect(mocks.restoreManifests).toHaveBeenCalledTimes(2);
  });

  it('closes a finished month once, booking its credits and keeping later packs for later', async () => {
    const organizationId = await createOrganization({
      usagePeriodStart: monthStart(-1),
      downloadsCount: 6_000,
      creditsUsed: 1_000,
    });
    // Last month's final count is higher than the last stored refresh.
    setDownloads(monthStart(-1), 7_000);
    setDownloads(monthStart(), 1_000);
    await applyCreditOrder(polarOrder(organizationId));
    await db.creditGrant.updateMany({
      where: { organizationId },
      data: { createdAt: new Date(monthStart().getTime() - 60_000) },
    });
    // Bought after the month ended: not spent on last month's downloads.
    await applyCreditOrder(polarOrder(organizationId));

    await Promise.all([
      refreshOrganizationUsageSnapshot(organizationId),
      refreshOrganizationUsageSnapshot(organizationId),
    ]);

    const organization = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    expect(organization.creditsConsumed).toBe(2_000);
    expect(organization.usagePeriodStart?.toISOString()).toBe(monthStart().toISOString());
    expect(await getOrganizationUsageSnapshot(organizationId)).toMatchObject({
      downloadsCount: 1_000,
      creditsUsed: 0,
      creditsRemaining: 8_000,
      effectiveLimit: 13_000,
    });
  });

  it('counts an unclosed month in the snapshot before the next refresh', async () => {
    const organizationId = await createOrganization({
      usagePeriodStart: monthStart(-1),
      downloadsCount: 6_000,
      creditsUsed: 1_000,
    });
    await applyCreditOrder(polarOrder(organizationId));
    expect(await getOrganizationUsageSnapshot(organizationId)).toMatchObject({
      downloadsCount: 0,
      creditsRemaining: 4_000,
    });
  });

  it('reports Pro additional usage without credit-covered downloads and back-dates the month close', async () => {
    const organizationId = await createOrganization({
      planKey: 'pro',
      overageEnabled: true,
      usagePeriodStart: monthStart(-1),
    });
    await applyCreditOrder(
      polarOrder(organizationId, { productId: 'product-1m', netAmount: 5_000 }),
    );
    await db.creditGrant.updateMany({
      where: { organizationId },
      data: { createdAt: monthStart(-1) },
    });
    setDownloads(monthStart(-1), 1_300_000);
    setDownloads(monthStart(), 1_200_000);
    mocks.quantities
      .mockResolvedValueOnce({ total: 1_000_000 })
      .mockResolvedValueOnce({ total: 0 });

    const snapshot = await refreshOrganizationUsageSnapshot(organizationId);

    // Last month went 300k over, all covered by the pack: nothing to add to the
    // 1M already reported. This month 200k over, covered too: the meter gets 1M.
    expect(mocks.ingest).toHaveBeenCalledTimes(1);
    const event = mocks.ingest.mock.calls[0][0].events[0];
    expect(event.metadata.quantity).toBe(1_000_000);
    expect(event.timestamp).toBeUndefined();
    expect(snapshot).toMatchObject({ creditsUsed: 200_000, creditsRemaining: 500_000 });

    const organization = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    expect(organization.creditsConsumed).toBe(300_000);
    expect(organization.polarReportedCount).toBe(1_000_000);
  });

  it('sends the final hours of a closed month to Polar, dated inside that month', async () => {
    const organizationId = await createOrganization({
      planKey: 'pro',
      overageEnabled: true,
      usagePeriodStart: monthStart(-1),
      polarReportedCount: 1_100_000,
    });
    setDownloads(monthStart(-1), 1_150_000);
    mocks.quantities
      .mockResolvedValueOnce({ total: 1_100_000 })
      .mockResolvedValueOnce({ total: 0 });

    await refreshOrganizationUsageSnapshot(organizationId);

    const event = mocks.ingest.mock.calls[0][0].events[0];
    expect(event.metadata.quantity).toBe(50_000);
    expect(event.timestamp).toEqual(new Date(monthStart().getTime() - 1000));
  });

  it('does not report Pro usage to Polar while additional usage is off', async () => {
    const organizationId = await createOrganization({ planKey: 'pro' });
    setDownloads(monthStart(), 1_050_000);

    expect(await refreshOrganizationUsageSnapshot(organizationId)).toMatchObject({
      usageBlocked: true,
    });
    expect(mocks.quantities).not.toHaveBeenCalled();
    expect(mocks.ingest).not.toHaveBeenCalled();

    // Turning it on unblocks at once; the next hourly check reports the usage.
    expect(await updateOrganizationOverageEnabled(organizationId, true)).toMatchObject({
      usageBlocked: false,
      overageEnabled: true,
    });
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it('starts over instead of saving stale numbers when another refresh wins', async () => {
    const organizationId = await createOrganization();
    setDownloads(monthStart(), 5_200);
    await refreshOrganizationUsageSnapshot(organizationId);
    expect(mocks.deleteManifests).toHaveBeenCalledTimes(1);

    // While this refresh counts, a pack lands and another refresh unblocks.
    mocks.duringCount = async () => {
      await applyCreditOrder(polarOrder(organizationId));
      await refreshOrganizationUsageSnapshot(organizationId);
    };
    expect(await refreshOrganizationUsageSnapshot(organizationId)).toMatchObject({
      usageBlocked: false,
      creditsUsed: 200,
    });
    const organization = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    expect(organization.usageBlocked).toBe(false);
    expect(mocks.restoreManifests).toHaveBeenCalledTimes(1);
  });

  it('does not write a closed month back when midnight passes mid-refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-30T23:59:59.500Z'));
    const november = new Date('2026-11-01T00:00:00.000Z');
    const december = new Date('2026-12-01T00:00:00.000Z');
    const organizationId = await createOrganization({
      usagePeriodStart: november,
      usageCalculatedAt: new Date('2026-11-30T23:00:00.000Z'),
      downloadsCount: 9_000,
      creditsUsed: 4_000,
    });
    await applyCreditOrder(polarOrder(organizationId));
    await db.creditGrant.updateMany({ where: { organizationId }, data: { createdAt: november } });
    setDownloads(november, 9_000);
    setDownloads(december, 100);

    // The clock passes midnight and another refresh closes November meanwhile.
    mocks.duringCount = async () => {
      vi.setSystemTime(new Date('2026-12-01T00:00:05.000Z'));
      await refreshOrganizationUsageSnapshot(organizationId);
    };
    await refreshOrganizationUsageSnapshot(organizationId);

    const organization = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    expect(organization.usagePeriodStart?.toISOString()).toBe(december.toISOString());
    expect(organization.creditsConsumed).toBe(4_000);
    expect(organization.downloadsCount).toBe(100);
  });

  it('closes a month with the allowance it had, not a plan changed afterwards', async () => {
    // Pro all November, cancelled to Free after midnight, before the close.
    const organizationId = await createOrganization({
      planKey: 'free',
      usagePeriodStart: monthStart(-1),
      usageIncludedLimit: 1_000_000,
      downloadsCount: 800_000,
    });
    await applyCreditOrder(
      polarOrder(organizationId, { productId: 'product-1m', netAmount: 5_000 }),
    );
    await db.creditGrant.updateMany({
      where: { organizationId },
      data: { createdAt: monthStart(-1) },
    });
    setDownloads(monthStart(-1), 800_000);

    await refreshOrganizationUsageSnapshot(organizationId);
    const organization = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    expect(organization.creditsConsumed).toBe(0);
    expect(organization.usageIncludedLimit).toBe(5_000);
  });

  it('keeps the additional usage toggle a customer changed during a refresh', async () => {
    const organizationId = await createOrganization({ planKey: 'pro', overageEnabled: true });
    setDownloads(monthStart(), 1_200_000);
    mocks.duringCount = async () => {
      await db.organization.update({
        where: { id: organizationId },
        data: { overageEnabled: false },
      });
    };
    await refreshOrganizationUsageSnapshot(organizationId, { syncPolar: false });
    const organization = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    expect(organization.overageEnabled).toBe(false);
  });

  it('retries a month close when Polar cannot take the final report', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const organizationId = await createOrganization({
      planKey: 'pro',
      overageEnabled: true,
      usagePeriodStart: monthStart(-1),
      polarReportedCount: 1_100_000,
    });
    setDownloads(monthStart(-1), 1_150_000);
    mocks.quantities.mockResolvedValue({ total: 1_100_000 });
    mocks.ingest.mockRejectedValueOnce(new Error('polar down'));

    await expect(refreshOrganizationUsageSnapshot(organizationId)).rejects.toThrow(
      'Polar ingest failed for the month close',
    );
    expect(
      (
        await db.organization.findUniqueOrThrow({ where: { id: organizationId } })
      ).usagePeriodStart?.toISOString(),
    ).toBe(monthStart(-1).toISOString());

    await refreshOrganizationUsageSnapshot(organizationId);
    expect(mocks.ingest.mock.calls[1][0].events[0].metadata.quantity).toBe(50_000);
    expect(
      (
        await db.organization.findUniqueOrThrow({ where: { id: organizationId } })
      ).usagePeriodStart?.toISOString(),
    ).toBe(monthStart().toISOString());
  });

  it("applies every customer's lost pack orders in one sync, without a stored customer id", async () => {
    const organizationId = await createOrganization();
    const order = polarOrder(organizationId);
    mocks.listOrders.mockImplementation(async () =>
      (async function* () {
        yield { result: { items: [order] } };
      })(),
    );

    expect((await syncCreditOrders()).changed).toBe(true);
    expect(mocks.listOrders).toHaveBeenCalledWith({
      productId: ['product-5k', 'product-100k', 'product-1m'],
      limit: 100,
    });
    expect(await getCreditPool(organizationId)).toBe(5_000);

    // Already applied: skipped without changes, still confirmed.
    const again = await syncCreditOrders();
    expect(again.changed).toBe(false);
    expect(again.paidCheckoutIds.has(order.checkoutId!)).toBe(true);
  });

  it('reconciles a pack whose webhook never arrived', async () => {
    const organizationId = await createOrganization({ polarCustomerId: 'customer-1' });
    setDownloads(monthStart(), 5_100);
    await refreshOrganizationUsageSnapshot(organizationId);
    const order = polarOrder(organizationId);
    mocks.listOrders.mockImplementation(async () =>
      (async function* () {
        yield { result: { items: [order, polarOrder(organizationId, { paid: false })] } };
      })(),
    );

    const synced = await syncCreditOrders(organizationId);
    expect(synced.changed).toBe(true);
    expect(synced.paidCheckoutIds).toEqual(new Set([order.checkoutId]));
    expect(mocks.listOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        externalCustomerId: `organization:${organizationId}`,
        productId: ['product-5k', 'product-100k', 'product-1m'],
      }),
    );
    expect(await refreshOrganizationUsageSnapshot(organizationId)).toMatchObject({
      usageBlocked: false,
      creditsUsed: 100,
    });

    // Already applied: a second sync confirms the checkout without changes.
    const again = await syncCreditOrders(organizationId);
    expect(again.changed).toBe(false);
    expect(again.paidCheckoutIds.has(order.checkoutId!)).toBe(true);
  });
});
