import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { listBundles } from '@/lib/services/bundles';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

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
  const rawLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
  const rawOffset = Number.parseInt(searchParams.get('offset') ?? '', 10);
  try {
    return NextResponse.json(
      await listBundles({
        appId,
        version: searchParams.get('version') ?? undefined,
        platform: searchParams.get('platform') ?? undefined,
        runtimeVersion: searchParams.get('runtimeVersion') ?? undefined,
        limit: Number.isInteger(rawLimit) ? rawLimit : undefined,
        offset: Number.isInteger(rawOffset) ? rawOffset : undefined,
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
