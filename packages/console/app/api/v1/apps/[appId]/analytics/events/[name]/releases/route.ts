import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { compareAppEventReleases } from '@/lib/services/app-events';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

/**
 * One custom event across releases: `?releaseIds=a,b` (up to 10), or the 5
 * latest releases of `?channel=` (empty = base channel; omitted = any channel).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; name: string }> },
) {
  const { appId, name } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const searchParams = request.nextUrl.searchParams;
  const releaseIds = searchParams
    .get('releaseIds')
    ?.split(',')
    .map((id) => id.trim());
  try {
    return NextResponse.json(
      await compareAppEventReleases({ organizationId: access.access.organizationId, appId }, name, {
        releaseIds: releaseIds?.filter(Boolean),
        channel: searchParams.has('channel') ? searchParams.get('channel') || null : undefined,
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
