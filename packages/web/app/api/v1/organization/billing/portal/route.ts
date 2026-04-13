import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/session';
import { getPolar, isPolarConfigured } from '@/lib/polar';
import { getExternalCustomerId } from '@/lib/billing/config';

export const runtime = 'nodejs';

export async function GET() {
  if (!isPolarConfigured()) {
    return NextResponse.json({ error: 'Billing is not configured on this instance' }, { status: 404 });
  }

  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const externalId = getExternalCustomerId(ctx.organizationId);

  try {
    const session = await getPolar().customerSessions.create({
      externalCustomerId: externalId,
    });

    return NextResponse.json({ portalUrl: session.customerPortalUrl });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'statusCode' in err &&
      (err as { statusCode: number }).statusCode === 404
    ) {
      return NextResponse.json(
        { error: 'No billing account found. Please subscribe to a plan first.' },
        { status: 404 },
      );
    }
    throw err;
  }
}
