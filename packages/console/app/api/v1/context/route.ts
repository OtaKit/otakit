import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { getConnectionContext } from '@/lib/services/context';
import { organizationAccessErrorResponse, serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const appIdValues = request.nextUrl.searchParams.getAll('appId');
  const appId = appIdValues[0]?.trim();
  if (appIdValues.length > 1 || (appIdValues.length === 1 && (!appId || appId.length > 128))) {
    return NextResponse.json({ error: 'Invalid app ID' }, { status: 400 });
  }

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return organizationAccessErrorResponse(access);
  }

  try {
    return NextResponse.json(await getConnectionContext(access.access, appId));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
