import { NextRequest, NextResponse } from 'next/server';
import type { PlanKey } from '@prisma/client';

import { db } from '@/lib/db';
import { getPolar } from '@/lib/polar';
import { getSessionContext } from '@/lib/session';
import { getExternalCustomerId, planKeyToProductId } from '@/lib/billing/config';

export const runtime = 'nodejs';

const VALID_PLAN_KEYS = new Set<string>(['pro', 'scale']);

export async function POST(request: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !VALID_PLAN_KEYS.has(body.planKey)) {
    return NextResponse.json(
      { error: 'Invalid planKey. Must be "pro" or "scale".' },
      { status: 400 },
    );
  }

  const planKey = body.planKey as PlanKey;
  const productId = planKeyToProductId(planKey);
  if (!productId) {
    return NextResponse.json({ error: 'Product not configured for this plan.' }, { status: 500 });
  }

  const organization = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { isActive: true, polarSubscriptionId: true },
  });
  if (organization?.isActive && organization.polarSubscriptionId) {
    return NextResponse.json(
      {
        error:
          'You already have an active subscription. Use the billing portal to manage your plan.',
      },
      { status: 409 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  try {
    const checkout = await getPolar().checkouts.create({
      products: [productId],
      externalCustomerId: getExternalCustomerId(ctx.organizationId),
      customerEmail: ctx.email,
      successUrl: `${appUrl}/dashboard/settings?pricing=1&checkout=success`,
      metadata: {
        organizationId: ctx.organizationId,
        initiatedByUserId: ctx.userId,
        targetPlan: planKey,
      },
    });

    return NextResponse.json({ checkoutUrl: checkout.url }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Failed to create checkout session. Please try again.' },
      { status: 502 },
    );
  }
}
