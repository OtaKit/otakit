import { Prisma } from '@prisma/client';
import type { Order } from '@polar-sh/sdk/models/components/order.js';

import { db } from '@/lib/db';
import { getPolar, isPolarConfigured } from '@/lib/polar';

import {
  configuredCreditPackProductIds,
  creditPackForProductId,
  parseOrganizationIdFromExternalId,
} from './config';

// Credits are pooled per organization. A grant is written once per paid Polar
// order (unique polarOrderId), so webhooks, retries and the order sync can all
// apply the same order safely.

/** Granted minus revoked downloads, optionally only grants made before a date. */
export async function getCreditPool(organizationId: string, createdBefore?: Date): Promise<number> {
  const result = await db.creditGrant.aggregate({
    where: {
      organizationId,
      ...(createdBefore ? { createdAt: { lt: createdBefore } } : {}),
    },
    _sum: { downloads: true, revokedDownloads: true },
  });
  return (result._sum.downloads ?? 0) - (result._sum.revokedDownloads ?? 0);
}

/**
 * Credits of `grant` a refund can still take back: the ones nobody used.
 * Counts the last computed use of the tracked month. When that month is over
 * but not closed yet (the first minutes after midnight UTC), its close only
 * draws on packs bought before it ended, so a pack from that time keeps what
 * the month used, even if a newer pack is still unused.
 */
async function getRevocableCredits(grant: CreditGrantRecord): Promise<number> {
  const [pool, organization] = await Promise.all([
    getCreditPool(grant.organizationId),
    db.organization.findUnique({
      where: { id: grant.organizationId },
      select: { creditsConsumed: true, creditsUsed: true, usagePeriodStart: true },
    }),
  ]);
  if (!organization) return 0;
  const used = organization.creditsConsumed + organization.creditsUsed;
  let revocable = pool - used;

  const trackedStart = organization.usagePeriodStart;
  if (trackedStart) {
    const trackedEnd = new Date(
      Date.UTC(trackedStart.getUTCFullYear(), trackedStart.getUTCMonth() + 1, 1),
    );
    if (trackedEnd <= new Date() && grant.createdAt < trackedEnd) {
      const poolForTrackedMonth = await getCreditPool(grant.organizationId, trackedEnd);
      revocable = Math.min(revocable, poolForTrackedMonth - used);
    }
  }
  return Math.max(0, revocable);
}

/**
 * Downloads to take back for a refund, from the cumulative refunded amount.
 * Uses the cumulative share on both sides so partial refunds never drift.
 */
export function refundedDownloadsShare(args: {
  downloads: number;
  amountCents: number;
  previousRefundedCents: number;
  refundedCents: number;
}): number {
  if (args.amountCents <= 0 || args.refundedCents <= args.previousRefundedCents) return 0;
  const shareOf = (cents: number) =>
    Math.floor((args.downloads * Math.min(cents, args.amountCents)) / args.amountCents);
  return shareOf(args.refundedCents) - shareOf(args.previousRefundedCents);
}

type CreditGrantRecord = {
  id: string;
  organizationId: string;
  downloads: number;
  revokedDownloads: number;
  amountCents: number;
  refundedCents: number;
  createdAt: Date;
};

const GRANT_SELECT = {
  id: true,
  organizationId: true,
  downloads: true,
  revokedDownloads: true,
  amountCents: true,
  refundedCents: true,
  createdAt: true,
} as const;

// Takes back only credits that are still unused: credits a customer already
// spent stay spent, and a refund never creates a debt that eats a later pack.
async function applyCreditRefund(
  grant: CreditGrantRecord,
  refundedCents: number,
): Promise<boolean> {
  let current = grant;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (refundedCents <= current.refundedCents) return false;

    const share = refundedDownloadsShare({
      downloads: current.downloads,
      amountCents: current.amountCents,
      previousRefundedCents: current.refundedCents,
      refundedCents,
    });
    const revocable = await getRevocableCredits(current);
    const revoke = Math.max(
      0,
      Math.min(share, revocable, current.downloads - current.revokedDownloads),
    );

    // Compare-and-set on refundedCents: a concurrent delivery of the same
    // refund cannot take the credits back twice.
    const { count } = await db.creditGrant.updateMany({
      where: { id: current.id, refundedCents: current.refundedCents },
      data: { refundedCents, revokedDownloads: { increment: revoke } },
    });
    if (count === 1) {
      console.info('[Credits] refund applied', {
        organizationId: current.organizationId,
        grantId: current.id,
        refundedCents,
        revokedDownloads: revoke,
      });
      return true;
    }

    const reloaded = await db.creditGrant.findUnique({
      where: { id: current.id },
      select: GRANT_SELECT,
    });
    if (!reloaded) return false;
    current = reloaded;
  }
  throw new Error(`Credit refund for grant ${grant.id} kept conflicting`);
}

/**
 * The workspace a pack order belongs to. The checkout stores it in metadata
 * (set by our server; the buyer cannot change it) and Polar copies that to the
 * order. The Polar customer is only a fallback: Polar can attach an order to an
 * existing customer, for example one created for another workspace.
 */
export function organizationIdForOrder(order: Order): string | null {
  const fromMetadata = order.metadata?.organizationId;
  const fromCustomer = parseOrganizationIdFromExternalId(order.customer?.externalId ?? '');
  if (typeof fromMetadata === 'string' && fromMetadata.length > 0) {
    if (fromCustomer && fromCustomer !== fromMetadata) {
      console.warn('[Credits] order customer belongs to another organization', {
        orderId: order.id,
        organizationId: fromMetadata,
        customerOrganizationId: fromCustomer,
      });
    }
    return fromMetadata;
  }
  return fromCustomer;
}

export type CreditOrderResult = {
  organizationId: string;
  changed: boolean;
};

/**
 * Applies a Polar order to the credit ledger: grants the pack once when the
 * order is paid and takes back credits for any refund. Returns null for
 * orders that are not credit packs (subscriptions, unknown products).
 */
export async function applyCreditOrder(order: Order): Promise<CreditOrderResult | null> {
  if (order.billingReason !== 'purchase') return null;
  const pack = creditPackForProductId(order.productId);
  if (!pack || !order.productId) return null;

  const organizationId = organizationIdForOrder(order);
  if (!organizationId) {
    console.warn('[Credits] order without an organization', { orderId: order.id });
    return null;
  }
  // A refunded order was paid before; Polar may report it with paid: false.
  const settled =
    order.paid || order.status === 'refunded' || order.status === 'partially_refunded';

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!organization) {
    console.warn('[Credits] order for a missing organization', {
      orderId: order.id,
      organizationId,
    });
    return null;
  }

  let changed = false;
  let grant = await db.creditGrant.findUnique({
    where: { polarOrderId: order.id },
    select: GRANT_SELECT,
  });
  if (!grant) {
    // Pending orders are applied once Polar reports them paid.
    if (!settled) return null;
    try {
      grant = await db.creditGrant.create({
        data: {
          organizationId,
          downloads: pack.downloads,
          polarOrderId: order.id,
          polarProductId: order.productId,
          amountCents: Math.max(0, order.netAmount),
          currency: order.currency,
        },
        select: GRANT_SELECT,
      });
      changed = true;
      console.info('[Credits] pack granted', {
        organizationId,
        orderId: order.id,
        pack: pack.key,
        downloads: pack.downloads,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
      grant = await db.creditGrant.findUniqueOrThrow({
        where: { polarOrderId: order.id },
        select: GRANT_SELECT,
      });
    }
  }

  if (grant.organizationId !== organizationId) {
    console.error('[Credits] order moved between organizations', {
      orderId: order.id,
      grantOrganizationId: grant.organizationId,
      organizationId,
    });
    return null;
  }

  if (await applyCreditRefund(grant, Math.max(0, order.refundedAmount))) changed = true;
  return { organizationId, changed };
}

/**
 * Re-reads credit pack orders from Polar and applies any that are missing or
 * newly refunded, covering late or lost webhooks. With an organization id only
 * that workspace's orders are read, by the checkout metadata (the settings page
 * after a checkout); without one, every workspace's (the hourly usage run).
 * Returns the checkouts whose orders are applied, so a caller can confirm one
 * purchase.
 */
export async function syncCreditOrders(organizationId?: string): Promise<{
  changed: boolean;
  paidCheckoutIds: Set<string>;
}> {
  const paidCheckoutIds = new Set<string>();
  if (!isPolarConfigured()) return { changed: false, paidCheckoutIds };
  const productIds = configuredCreditPackProductIds();
  if (productIds.length === 0) return { changed: false, paidCheckoutIds };

  let changed = false;
  const pages = await getPolar().orders.list({
    ...(organizationId ? { metadata: { organizationId } } : {}),
    productId: productIds,
    limit: 100,
  });
  for await (const page of pages) {
    const orders = page.result.items;
    // Skip orders that are already applied with their current refund, so the
    // hourly full read costs one query per page, not several per order.
    const applied = new Map(
      (
        await db.creditGrant.findMany({
          where: { polarOrderId: { in: orders.map((order) => order.id) } },
          select: { polarOrderId: true, refundedCents: true },
        })
      ).map((grant) => [grant.polarOrderId, grant.refundedCents]),
    );

    for (const order of orders) {
      const refundedCents = applied.get(order.id);
      if (refundedCents !== undefined && Math.max(0, order.refundedAmount) <= refundedCents) {
        if (order.checkoutId) paidCheckoutIds.add(order.checkoutId);
        continue;
      }
      const result = await applyCreditOrder(order);
      if (result?.changed) changed = true;
      if (result && order.checkoutId) paidCheckoutIds.add(order.checkoutId);
    }
  }
  return { changed, paidCheckoutIds };
}
