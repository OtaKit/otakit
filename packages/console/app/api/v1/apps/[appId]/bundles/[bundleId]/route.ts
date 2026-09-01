import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { deleteBundle, getBundle } from '@/lib/services/bundles';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; bundleId: string }> },
) {
  const { appId, bundleId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    return NextResponse.json(await getBundle(appId, bundleId));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; bundleId: string }> },
) {
  const { appId, bundleId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    return NextResponse.json(await deleteBundle({ access: access.access, appId, bundleId }));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
