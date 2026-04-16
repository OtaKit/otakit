import { NextRequest, NextResponse } from 'next/server';
import { Webhooks } from '@polar-sh/nextjs';

import { refreshBillingState } from '@/lib/billing/service';
import { parseOrganizationIdFromExternalId } from '@/lib/billing/config';
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

async function handleBillingWebhook(payload: PolarWebhookPayload): Promise<void> {
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

const polarWebhookHandler = isPolarConfigured() && process.env.POLAR_WEBHOOK_SECRET
  ? Webhooks({
      webhookSecret: process.env.POLAR_WEBHOOK_SECRET,
      onPayload: (payload) => handleBillingWebhook(payload),
    })
  : null;

export async function POST(request: NextRequest) {
  if (!polarWebhookHandler) {
    return NextResponse.json({ error: 'Billing webhooks are not configured on this instance' }, { status: 404 });
  }
  return polarWebhookHandler(request);
}
