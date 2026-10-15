import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { listAppEvents } from '@/lib/services/app-events';
import { serviceErrorResponse } from '@/lib/services/http';

import { analyticsFilters } from '../filters';

export const runtime = 'nodejs';

/** Custom event names with events in the range, most first. `trend=1` adds buckets per name. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  try {
    return NextResponse.json(
      await listAppEvents(
        { organizationId: access.access.organizationId, appId },
        {
          ...analyticsFilters(request),
          includeTrend: request.nextUrl.searchParams.get('trend') === '1',
        },
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
