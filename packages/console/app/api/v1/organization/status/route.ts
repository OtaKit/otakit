import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { getAccountStatus } from '@/lib/services/account';
import { organizationAccessErrorResponse, serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const access = await resolveOrganizationAccess(request);
  if (!access.success) {
    return organizationAccessErrorResponse(access);
  }

  try {
    return NextResponse.json(await getAccountStatus(access.access));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
