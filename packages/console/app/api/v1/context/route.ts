import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { getConnectionContext } from '@/lib/services/context';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const access = await resolveOrganizationAccess(request);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    return NextResponse.json(await getConnectionContext(access.access));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
