import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { serviceErrorResponse } from '@/lib/services/http';
import { getRemoteConfigHistory, parseConfigChannel } from '@/lib/services/remote-config';

export const runtime = 'nodejs';

/** The last 50 versions of a channel's config, newest first. */
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
    return NextResponse.json({
      versions: await getRemoteConfigHistory({
        organizationId: access.access.organizationId,
        appId,
        channel: parseConfigChannel(request.nextUrl.searchParams.get('channel')),
      }),
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
