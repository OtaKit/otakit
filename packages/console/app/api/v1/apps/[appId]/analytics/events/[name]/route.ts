import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { getAppEvent } from '@/lib/services/app-events';
import { serviceErrorResponse } from '@/lib/services/http';

import { analyticsFilters } from '../../filters';

export const runtime = 'nodejs';

/** One custom event: totals, events per hour or day, and its property keys. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; name: string }> },
) {
  const { appId, name } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  try {
    return NextResponse.json(
      await getAppEvent(
        { organizationId: access.access.organizationId, appId },
        name,
        analyticsFilters(request),
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
