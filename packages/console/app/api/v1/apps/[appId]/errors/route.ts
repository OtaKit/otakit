import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { listErrorIssues, parseErrorIssueFilters } from '@/lib/services/error-issues';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

/**
 * Error issues with events in a range:
 * `?range=24h|7d|30d&status=open|resolved|ignored|all&platform=&releaseId=&channel=&sort=events|last_seen&limit=&trend=1`.
 * Without `channel`, every channel; `channel=` (empty) is the base channel. Messages are
 * device-reported text.
 */
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
  const channel = searchParams.has('channel') ? searchParams.get('channel') || null : undefined;
  try {
    const filters = parseErrorIssueFilters({
      range: searchParams.get('range'),
      status: searchParams.get('status'),
      platform: searchParams.get('platform'),
      releaseId: searchParams.get('releaseId'),
      channel,
      sort: searchParams.get('sort'),
      limit: searchParams.get('limit'),
    });
    return NextResponse.json(
      await listErrorIssues(
        { organizationId: access.access.organizationId, appId },
        { ...filters, includeTrend: searchParams.get('trend') === '1' },
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
