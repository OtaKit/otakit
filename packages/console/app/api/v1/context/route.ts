import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { getConnectionContext } from '@/lib/services/context';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const access = await resolveOrganizationAccess(request, undefined, {
    requireExplicitOrganizationForMultipleMemberships: true,
  });
  if (!access.success) {
    return NextResponse.json(
      {
        error: access.error,
        ...(access.code ? { code: access.code } : {}),
        ...(access.nextStep ? { nextStep: access.nextStep } : {}),
      },
      { status: access.status },
    );
  }

  try {
    return NextResponse.json(await getConnectionContext(access.access));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
