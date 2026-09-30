import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { serviceErrorResponse } from '@/lib/services/http';
import { listPreviews } from '@/lib/services/previews';

export const runtime = 'nodejs';

/** Active preview links of an app, optionally of one bundle (`?bundleId=`). */
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
      await listPreviews({
        organizationId: access.access.organizationId,
        appId,
        bundleId: request.nextUrl.searchParams.get('bundleId')?.trim() || undefined,
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
