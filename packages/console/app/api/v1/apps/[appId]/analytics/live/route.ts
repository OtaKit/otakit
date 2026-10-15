import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { listLatestAppEvents } from '@/lib/services/app-events';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

/** The latest custom events of the last 24 hours, newest first: `?name=&limit=` (up to 100). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const searchParams = request.nextUrl.searchParams;
  const limit = Number(searchParams.get('limit') ?? 100);
  try {
    return NextResponse.json(
      await listLatestAppEvents(
        { organizationId: access.access.organizationId, appId },
        { name: searchParams.get('name'), limit: Number.isFinite(limit) ? limit : 100 },
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
