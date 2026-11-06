import { NextRequest, NextResponse } from 'next/server';

import { parseEventFilters } from '@/lib/event-filters';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import {
  EVENT_ACTIVITY_RANGES,
  EVENT_ACTIVITY_SPLITS,
  getEventActivity,
  isEventActivityRange,
  isEventActivitySplit,
} from '@/lib/services/event-activity';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

/** UTC-14:00 to UTC+14:00, the widest offsets in use. */
const MAX_TZ_OFFSET_MINUTES = 14 * 60;

/**
 * An app's device events per time bucket under the event list's filters,
 * split by one dimension, with release markers: the activity chart's data.
 */
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
  const range = searchParams.get('range') ?? '24h';
  if (!isEventActivityRange(range)) {
    return NextResponse.json(
      { error: `Invalid range. Must be one of: ${Object.keys(EVENT_ACTIVITY_RANGES).join(', ')}` },
      { status: 400 },
    );
  }
  const splitBy = searchParams.get('splitBy') ?? 'action';
  if (!isEventActivitySplit(splitBy)) {
    return NextResponse.json(
      { error: `Invalid splitBy. Must be one of: ${EVENT_ACTIVITY_SPLITS.join(', ')}` },
      { status: 400 },
    );
  }
  const rawOffset = searchParams.get('tzOffset');
  const tzOffsetMinutes = rawOffset === null || rawOffset === '' ? 0 : Number(rawOffset);
  if (!Number.isInteger(tzOffsetMinutes) || Math.abs(tzOffsetMinutes) > MAX_TZ_OFFSET_MINUTES) {
    return NextResponse.json(
      { error: 'Invalid tzOffset. Use Date.getTimezoneOffset() minutes.' },
      { status: 400 },
    );
  }
  const parsedFilters = parseEventFilters(searchParams);
  if (!parsedFilters.ok) {
    return NextResponse.json({ error: parsedFilters.error }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await getEventActivity({
        organizationId: access.access.organizationId,
        appId,
        range,
        splitBy,
        tzOffsetMinutes,
        filters: parsedFilters.filters,
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
