import { NextRequest, NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/session';
import { getOnboardingSnapshot } from '@/lib/services/onboarding';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const expectedOrganization = request.headers.get('x-otakit-organization-id');
  if (expectedOrganization && expectedOrganization !== ctx.organizationId) {
    return NextResponse.json(
      { error: 'Your active workspace changed. Reload to continue.' },
      { status: 409 },
    );
  }

  try {
    const appId = request.nextUrl.searchParams.get('appId')?.trim();
    const snapshot = await getOnboardingSnapshot({
      organizationId: ctx.organizationId,
      appId: appId || undefined,
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
