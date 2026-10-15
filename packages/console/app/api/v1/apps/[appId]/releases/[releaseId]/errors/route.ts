import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { getReleaseErrorComparison } from '@/lib/services/error-issues';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

/** A release's error events, issues and rate per 1,000 applies, next to the release it replaced. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; releaseId: string }> },
) {
  const { appId, releaseId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  try {
    return NextResponse.json(
      await getReleaseErrorComparison(
        { organizationId: access.access.organizationId, appId },
        releaseId,
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
