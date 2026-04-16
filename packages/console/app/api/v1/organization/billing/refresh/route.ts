import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/session';
import { isPolarConfigured } from '@/lib/polar';
import { refreshBillingState } from '@/lib/billing/service';

export const runtime = 'nodejs';

export async function POST() {
  if (!isPolarConfigured()) {
    return NextResponse.json({ error: 'Billing is not configured on this instance' }, { status: 404 });
  }

  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const billing = await refreshBillingState(ctx.organizationId);
    return NextResponse.json({ billing });
  } catch {
    return NextResponse.json(
      { error: 'Failed to refresh billing state. Please try again.' },
      { status: 502 },
    );
  }
}
