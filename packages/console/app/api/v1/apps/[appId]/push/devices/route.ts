import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { getDeviceOverview, getPushUsage, listDevices } from '@/lib/push/device-admin';
import { organizationAccessErrorResponse, serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) return organizationAccessErrorResponse(access);
  try {
    const search = request.nextUrl.searchParams.get('search');
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 50);
    const [overview, devices, usage] = await Promise.all([
      getDeviceOverview(appId),
      listDevices({ appId, search, limit }),
      getPushUsage(access.access.organizationId),
    ]);
    return NextResponse.json({ overview, devices, usage });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
