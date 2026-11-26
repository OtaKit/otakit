import { Prisma } from '@prisma/client';
import type { Order } from '@polar-sh/sdk/models/components/order.js';

import { db } from '@/lib/db';
import { getPolar, isPolarConfigured } from '@/lib/polar';

import {
  configuredCreditPackProductIds,
  creditPackForProductId,
  getExternalCustomerId,
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

/** Credits left right now, using the last computed use of the open month. */
async function getRemainingCredits(organizationId: string): Promise<number> {
  const [pool, organization] = await Promise.all([
    getCreditPool(organizationId),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { creditsConsumed: true, creditsUsed: true },
    }),
  ]);
  if (!organization) return 0;
  return Math.max(0, pool - organization.creditsConsumed - organization.creditsUsed);
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
};

const GRANT_SELECT = {
  id: true,
  organizationId: true,
  downloads: true,
  revokedDownloads: true,
  amountCents: true,
  refundedCents: true,
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
    const remaining = await getRemainingCredits(current.organizationId);
    const revoke = Math.max(
      0,
      Math.min(share, remaining, current.downloads - current.revokedDownloads),
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

  const organizationId = parseOrganizationIdFromExternalId(order.customer?.externalId ?? '');
  if (!organizationId) {
    console.warn('[Credits] order without an organization customer', { orderId: order.id });
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
 * Re-reads the organization's credit pack orders from Polar and applies any
 * that are missing or newly refunded. Covers late or lost webhooks. Returns
 * the checkouts whose orders are paid, so a caller can confirm one purchase.
 */
export async function syncCreditOrders(
  organizationId: string,
): Promise<{ changed: boolean; paidCheckoutIds: Set<string> }> {
  const paidCheckoutIds = new Set<string>();
  if (!isPolarConfigured()) return { changed: false, paidCheckoutIds };
  const productIds = configuredCreditPackProductIds();
  if (productIds.length === 0) return { changed: false, paidCheckoutIds };

  let changed = false;
  const pages = await getPolar().orders.list({
    externalCustomerId: getExternalCustomerId(organizationId),
    productId: productIds,
    limit: 100,
  });
  for await (const page of pages) {
    for (const order of page.result.items) {
      const result = await applyCreditOrder(order);
      if (result?.changed) changed = true;
      if (result && order.checkoutId) paidCheckoutIds.add(order.checkoutId);
    }
  }
  return { changed, paidCheckoutIds };
}
