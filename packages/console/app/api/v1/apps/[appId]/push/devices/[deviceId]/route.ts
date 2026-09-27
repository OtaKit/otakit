import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { deleteDevice } from '@/lib/push/device-admin';
import { organizationAccessErrorResponse, serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; deviceId: string }> },
) {
  const { appId, deviceId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) return organizationAccessErrorResponse(access);
  try {
    await deleteDevice(appId, deviceId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
