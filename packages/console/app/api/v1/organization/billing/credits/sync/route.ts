import { NextRequest, NextResponse } from 'next/server';

import { isPolarConfigured } from '@/lib/polar';
import { checkRateLimit } from '@/lib/rate-limit';
import { getSessionContext } from '@/lib/session';
import { syncCreditOrders } from '@/lib/billing/credits';
import { getPurchasableCreditPack } from '@/lib/billing/config';
import { getOrganizationEntitlements } from '@/lib/billing/service';
import { getOrganizationUsageSnapshot, refreshUsageAfterCreditChange } from '@/lib/billing/usage';

export const runtime = 'nodejs';

const CHECKOUT_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

// Called by the settings page after a pack checkout: the webhook can arrive
// after the customer is back, so read the paid orders from Polar directly.
// `confirmed` says whether the given checkout's order is paid and applied.
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

  const { allowed } = await checkRateLimit('credit-sync', ctx.organizationId, 20, 60);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const checkoutId =
    typeof body?.checkoutId === 'string' && CHECKOUT_ID_PATTERN.test(body.checkoutId)
      ? body.checkoutId
      : null;

  let changed = false;
  let confirmed = false;
  try {
    const result = await syncCreditOrders(ctx.organizationId);
    changed = result.changed;
    confirmed = checkoutId ? result.paidCheckoutIds.has(checkoutId) : changed;
  } catch (error) {
    console.error('[CreditsSync] order sync failed', {
      organizationId: ctx.organizationId,
      error,
    });
    return NextResponse.json(
      { error: 'Failed to check your purchase. Please try again.' },
      { status: 502 },
    );
  }

  const usage =
    (changed ? await refreshUsageAfterCreditChange(ctx.organizationId) : null) ??
    (await getOrganizationUsageSnapshot(ctx.organizationId));
  const { planKey } = await getOrganizationEntitlements(ctx.organizationId);
  return NextResponse.json({
    changed,
    confirmed,
    usage,
    creditPack: getPurchasableCreditPack(planKey),
  });
}
