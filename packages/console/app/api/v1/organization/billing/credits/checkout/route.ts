import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { getPolar, isPolarConfigured } from '@/lib/polar';
import { getSessionContext } from '@/lib/session';
import { creditPackProductId, getExternalCustomerId } from '@/lib/billing/config';
import { getCreditPackForPlan, isCreditPackKey } from '@/lib/billing/credit-packs';

export const runtime = 'nodejs';

// One-time checkout for the extra download pack of the workspace's plan. The
// credits are granted when Polar reports the order as paid (webhook or sync).
export async function POST(request: NextRequest) {
  if (!isPolarConfigured()) {
    return NextResponse.json(
      { error: 'Billing is not configured on this instance' },
      { status: 404 },
    );
  }

  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const expectedOrganization = request.headers.get('x-otakit-organization-id');
  if (expectedOrganization && expectedOrganization !== ctx.organizationId) {
    return NextResponse.json(
      { error: 'Your active workspace changed. Reload to continue.' },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || !isCreditPackKey(body.pack)) {
    return NextResponse.json({ error: 'Invalid pack.' }, { status: 400 });
  }

  const organization = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { planKey: true },
  });
  const pack = getCreditPackForPlan(organization?.planKey ?? 'free');
  if (!pack) {
    return NextResponse.json(
      { error: 'Extra downloads are part of your Enterprise contract. Contact us to change it.' },
      { status: 400 },
    );
  }
  // The page showed another plan's pack: the plan changed since it loaded.
  if (pack.key !== body.pack) {
    return NextResponse.json(
      { error: 'Your plan changed. Reload to see the extra downloads for your plan.' },
      { status: 409 },
    );
  }

  const productId = creditPackProductId(pack.key);
  if (!productId) {
    return NextResponse.json(
      { error: 'Extra downloads are not available on this instance.' },
      { status: 500 },
    );
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';

  try {
    const checkout = await getPolar().checkouts.create({
      products: [productId],
      externalCustomerId: getExternalCustomerId(ctx.organizationId),
      customerEmail: ctx.email,
      // Polar replaces {CHECKOUT_ID}, so the page can confirm this purchase.
      successUrl: `${appUrl}/dashboard/settings?credits=success&credits_org=${encodeURIComponent(ctx.organizationId)}&checkout_id={CHECKOUT_ID}`,
      returnUrl: `${appUrl}/dashboard/settings`,
      metadata: {
        organizationId: ctx.organizationId,
        initiatedByUserId: ctx.userId,
        creditPack: pack.key,
      },
    });

    return NextResponse.json({ checkoutUrl: checkout.url }, { status: 201 });
  } catch (error) {
    console.error('[CreditsCheckout] checkout creation failed', {
      organizationId: ctx.organizationId,
      error,
    });
    return NextResponse.json(
      { error: 'Failed to start checkout. Please try again.' },
      { status: 502 },
    );
  }
}
