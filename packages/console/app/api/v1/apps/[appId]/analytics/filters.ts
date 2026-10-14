import type { NextRequest } from 'next/server';

import { parseAppEventFilters } from '@/lib/services/app-events';

/**
 * `?range=24h|7d|30d|90d&platform=ios|android&releaseId=&channel=`. Without
 * `channel`, every channel; `channel=` (empty) is the base channel.
 */
export function analyticsFilters(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  return parseAppEventFilters({
    range: searchParams.get('range'),
    platform: searchParams.get('platform'),
    releaseId: searchParams.get('releaseId'),
    channel: searchParams.has('channel') ? searchParams.get('channel') || null : undefined,
  });
}
