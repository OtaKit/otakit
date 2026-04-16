import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/session';
import { getBillingState } from '@/lib/billing/service';

export const runtime = 'nodejs';

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const billing = await getBillingState(ctx.organizationId);

  return NextResponse.json({ billing });
}
