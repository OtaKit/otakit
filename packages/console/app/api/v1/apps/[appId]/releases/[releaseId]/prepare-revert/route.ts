import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { serviceErrorResponse } from '@/lib/services/http';
import { prepareRevert } from '@/lib/services/releases';

export const runtime = 'nodejs';

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
      await prepareRevert({
        organizationId: access.access.organizationId,
        appId,
        releaseId,
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
