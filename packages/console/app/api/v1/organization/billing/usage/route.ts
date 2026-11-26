import { NextRequest, NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/session';
import {
  getOrganizationUsageSnapshot,
  refreshOrganizationUsageSnapshot,
  updateOrganizationOverageEnabled,
} from '@/lib/billing/usage';
import { getPurchasableCreditPack } from '@/lib/billing/config';
import { getOrganizationEntitlements } from '@/lib/billing/service';

export const runtime = 'nodejs';

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let usage;
  try {
    usage = await refreshOrganizationUsageSnapshot(ctx.organizationId, {
      sendWarnings: false,
      syncPolar: false,
    });
  } catch (error) {
    console.error('[UsageRoute] refresh failed', {
      organizationId: ctx.organizationId,
      error,
    });
    usage = await getOrganizationUsageSnapshot(ctx.organizationId);
  }

  const entitlements = await getOrganizationEntitlements(ctx.organizationId);
  return NextResponse.json({ usage, creditPack: getPurchasableCreditPack(entitlements.planKey) });
}

export async function PATCH(request: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.overageEnabled !== 'boolean') {
    return NextResponse.json(
      { error: 'Invalid body. Expected { overageEnabled: boolean }.' },
      { status: 400 },
    );
  }

  const entitlements = await getOrganizationEntitlements(ctx.organizationId);
  if (body.overageEnabled && !entitlements.limits.overage) {
    return NextResponse.json(
      { error: 'Additional usage is only available on the Pro plan.' },
      { status: 400 },
    );
  }

  const usage = await updateOrganizationOverageEnabled(ctx.organizationId, body.overageEnabled);
  return NextResponse.json({ usage, creditPack: getPurchasableCreditPack(entitlements.planKey) });
}
