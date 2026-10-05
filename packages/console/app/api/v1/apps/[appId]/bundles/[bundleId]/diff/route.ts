import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { getBundleDiff } from '@/lib/services/bundle-diff';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

/**
 * Compare a bundle with `against` (a bundle ID), with the bundle a channel
 * runs (`channel`, empty for the base channel), or by default with the
 * previous upload of the same runtime version.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; bundleId: string }> },
) {
  const { appId, bundleId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const searchParams = request.nextUrl.searchParams;
  const against = searchParams.get('against')?.trim() || undefined;
  const channel = searchParams.has('channel')
    ? searchParams.get('channel')?.trim() || null
    : undefined;
  if (against !== undefined && channel !== undefined) {
    return NextResponse.json(
      { error: 'Pass either against or channel, not both' },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await getBundleDiff({
        organizationId: access.access.organizationId,
        appId,
        bundleId,
        against,
        channel,
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
