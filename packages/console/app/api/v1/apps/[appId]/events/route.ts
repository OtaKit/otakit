import { NextRequest, NextResponse } from 'next/server';

import { parseEventFilters } from '@/lib/event-filters';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { listEvents } from '@/lib/services/events';
import { parseNonNegativeInteger } from '@/lib/validation';

export const runtime = 'nodejs';

const TIMEFRAME_TO_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const routeParams = await params;
  const appId = routeParams.appId;

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const searchParams = request.nextUrl.searchParams;

  const parsedFilters = parseEventFilters(searchParams);
  if (!parsedFilters.ok) {
    return NextResponse.json({ error: parsedFilters.error }, { status: 400 });
  }
  const { platform, action, bundleVersion, channel, runtimeVersion } = parsedFilters.filters;

  const rawReleaseId = searchParams.get('releaseId');
  const releaseId = rawReleaseId && rawReleaseId !== 'all' ? rawReleaseId.trim() : null;
  if (releaseId && releaseId.length > 64) {
    return NextResponse.json({ error: 'Invalid releaseId filter' }, { status: 400 });
  }

  const rawFrom = searchParams.get('from');
  const parsedFrom = rawFrom ? new Date(rawFrom) : null;
  if (parsedFrom && Number.isNaN(parsedFrom.getTime())) {
    return NextResponse.json({ error: 'Invalid from timestamp' }, { status: 400 });
  }
  const rawTo = searchParams.get('to');
  const parsedTo = rawTo ? new Date(rawTo) : null;
  if (parsedTo && Number.isNaN(parsedTo.getTime())) {
    return NextResponse.json({ error: 'Invalid to timestamp' }, { status: 400 });
  }
  const rawTimeframe = searchParams.get('timeframe') ?? '24h';
  const timeframeMs = TIMEFRAME_TO_MS[rawTimeframe];
  if (!rawFrom && !timeframeMs) {
    return NextResponse.json(
      {
        error: `Invalid timeframe filter. Must be one of: ${Object.keys(TIMEFRAME_TO_MS).join(', ')}`,
      },
      { status: 400 },
    );
  }

  const limit = Math.max(1, Math.min(parseNonNegativeInteger(searchParams.get('limit'), 50), 200));
  const createdAtFrom = parsedFrom ?? new Date(Date.now() - timeframeMs);

  const includeDetail = searchParams.get('includeDetail') !== 'false';
  const result = await listEvents({
    appId,
    from: createdAtFrom,
    to: parsedTo ?? undefined,
    limit,
    platform,
    action,
    bundleVersion,
    channel,
    runtimeVersion,
    releaseId,
    includeDetail,
  });

  return NextResponse.json(result);
}
