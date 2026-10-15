import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { serviceErrorResponse } from '@/lib/services/http';
import { listRemoteConfigs } from '@/lib/services/remote-config';

export const runtime = 'nodejs';

/** Every channel that has or had config, base channel first. */
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
      configs: await listRemoteConfigs({ organizationId: access.access.organizationId, appId }),
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
