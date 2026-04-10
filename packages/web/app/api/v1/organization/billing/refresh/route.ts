import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/session';
import { refreshBillingState } from '@/lib/billing/service';

export const runtime = 'nodejs';

export async function POST() {
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
