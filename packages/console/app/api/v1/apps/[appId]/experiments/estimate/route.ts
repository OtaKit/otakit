import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { estimateExperiment } from '@/lib/services/experiments';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

/**
 * A rough sample size for a new test: `?goal=&channel=` (channel omitted =
 * every channel), from the last 14 days of app launches and the goal event.
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
  try {
    return NextResponse.json(
      await estimateExperiment(
        { organizationId: access.access.organizationId, appId },
        {
          goalEvent: searchParams.get('goal'),
          channel: searchParams.has('channel') ? searchParams.get('channel') : undefined,
        },
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
