import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { serviceErrorResponse } from '@/lib/services/http';
import { getRolloutReach } from '@/lib/services/rollout-reach';

export const runtime = 'nodejs';

/**
 * How many recent updates on a lane come from plugins too old for rollouts:
 * `?channel=&runtimeVersion=` (empty = base channel / no runtime version).
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
      await getRolloutReach(
        { organizationId: access.access.organizationId, appId },
        {
          channel: searchParams.get('channel') || null,
          runtimeVersion: searchParams.get('runtimeVersion') || null,
        },
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
