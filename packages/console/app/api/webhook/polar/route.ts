import { NextRequest, NextResponse } from 'next/server';
import { Webhooks } from '@polar-sh/nextjs';
import type { Order } from '@polar-sh/sdk/models/components/order.js';

import { refreshBillingState } from '@/lib/billing/service';
import { parseOrganizationIdFromExternalId } from '@/lib/billing/config';
import { applyCreditOrder } from '@/lib/billing/credits';
import { refreshUsageAfterCreditChange } from '@/lib/billing/usage';
import { isPolarConfigured } from '@/lib/polar';

export const runtime = 'nodejs';

type PolarWebhookPayload = {
  type: string;
  data: unknown;
};

const BILLING_EVENT_TYPES = new Set<string>([
  'subscription.created',
  'subscription.updated',
  'subscription.active',
  'subscription.canceled',
  'subscription.uncanceled',
  'subscription.revoked',
  'subscription.past_due',
  'customer.state_changed',
]);

// Extra download packs: grant on payment, take back unused credits on refund.
const CREDIT_ORDER_EVENT_TYPES = new Set<string>(['order.paid', 'order.refunded']);

function getExternalId(payload: PolarWebhookPayload): string | null {
  const data = payload.data as unknown;
  if (!data || typeof data !== 'object') {
    return null;
  }

  const customerExternalId = (data as { customer?: { externalId?: string | null } }).customer
    ?.externalId;
  if (typeof customerExternalId === 'string' && customerExternalId.length > 0) {
    return customerExternalId;
  }

  const directExternalId = (data as { externalId?: string | null }).externalId;
  if (typeof directExternalId === 'string' && directExternalId.length > 0) {
    return directExternalId;
  }

  return null;
}

async function handleCreditOrderWebhook(payload: PolarWebhookPayload): Promise<void> {
  // A failure to write the grant throws, so Polar retries the delivery.
  const result = await applyCreditOrder(payload.data as Order);
  if (!result) return;

  // Refresh even when the order sync applied it first, so the block state is
  // always current. The refresh is idempotent and never throws.
  await refreshUsageAfterCreditChange(result.organizationId);
  console.info(
    `[Polar webhook] Credit order applied for organization ${result.organizationId} (${payload.type})`,
  );
}

async function handleBillingWebhook(payload: PolarWebhookPayload): Promise<void> {
  if (CREDIT_ORDER_EVENT_TYPES.has(payload.type)) {
    await handleCreditOrderWebhook(payload);
    return;
  }

  if (!BILLING_EVENT_TYPES.has(payload.type)) {
    return;
  }

  const externalId = getExternalId(payload);
  if (!externalId) {
    console.warn(`[Polar webhook] Ignored ${payload.type}: missing externalId`);
    return;
  }

  const organizationId = parseOrganizationIdFromExternalId(externalId);
  if (!organizationId) {
    console.warn(`[Polar webhook] Ignored ${payload.type}: invalid externalId ${externalId}`);
    return;
  }

  await refreshBillingState(organizationId);
  console.info(
    `[Polar webhook] Billing state refreshed for organization ${organizationId} (${payload.type})`,
  );
}

const polarWebhookHandler =
  isPolarConfigured() && process.env.POLAR_WEBHOOK_SECRET
    ? Webhooks({
        webhookSecret: process.env.POLAR_WEBHOOK_SECRET,
        onPayload: (payload) => handleBillingWebhook(payload),
      })
    : null;

export async function POST(request: NextRequest) {
  if (!polarWebhookHandler) {
    return NextResponse.json(
      { error: 'Billing webhooks are not configured on this instance' },
      { status: 404 },
    );
  }
  return polarWebhookHandler(request);
}
