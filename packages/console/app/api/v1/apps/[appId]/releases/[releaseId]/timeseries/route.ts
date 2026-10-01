import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { serviceErrorResponse } from '@/lib/services/http';
import {
  getReleaseTimeseries,
  isReleaseTimeseriesRange,
  RELEASE_TIMESERIES_RANGES,
} from '@/lib/services/release-timeseries';

export const runtime = 'nodejs';

const PLATFORMS = ['ios', 'android'] as const;

/** Client-reported events of a release per hour or day, for health charts. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; releaseId: string }> },
) {
  const { appId, releaseId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const searchParams = request.nextUrl.searchParams;
  const range = searchParams.get('range');
  if (range !== null && !isReleaseTimeseriesRange(range)) {
    return NextResponse.json(
      { error: `Invalid range. Must be one of: ${RELEASE_TIMESERIES_RANGES.join(', ')}` },
      { status: 400 },
    );
  }
  const platform = searchParams.get('platform') || null;
  if (platform !== null && !PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) {
    return NextResponse.json(
      { error: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await getReleaseTimeseries({
        organizationId: access.access.organizationId,
        appId,
        releaseId,
        range: range ?? undefined,
        platform: platform as (typeof PLATFORMS)[number] | null,
        lane: searchParams.get('lane') === '1' || searchParams.get('lane') === 'true',
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
