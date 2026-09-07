import { NextRequest, NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/session';
import { onboardingRequestSchema } from '@/lib/onboarding-profile';
import { getOnboardingProfile, updateOnboardingProfile } from '@/lib/services/onboarding-profile';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    return NextResponse.json({ profile: await getOnboardingProfile(ctx.organizationId) });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const expectedOrganization = request.headers.get('x-otakit-organization-id');
  if (expectedOrganization && expectedOrganization !== ctx.organizationId) {
    return NextResponse.json(
      { error: 'Your active workspace changed. Reload to continue.' },
      { status: 409 },
    );
  }
  const parsed = onboardingRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Check your answers and try again.', fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json({ profile: await updateOnboardingProfile(ctx, parsed.data) });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
