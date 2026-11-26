import { NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/session';
import {
  getOrganizationUsageSnapshot,
  refreshOrganizationUsageSnapshot,
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
    usage = await refreshOrganizationUsageSnapshot(ctx.organizationId, { sendWarnings: false });
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
