import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { listEvents } from '@/lib/services/events';
import {
  isValidChannelName,
  isValidRuntimeVersion,
  parseNonNegativeInteger,
  parsePlatform,
} from '@/lib/validation';

export const runtime = 'nodejs';

const VALID_ACTIONS = ['downloaded', 'applied', 'download_error', 'rollback'] as const;

type ValidAction = (typeof VALID_ACTIONS)[number];

const TIMEFRAME_TO_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function isValidAction(value: string): value is ValidAction {
  return VALID_ACTIONS.includes(value as ValidAction);
}

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

  const rawPlatform = searchParams.get('platform');
  const platform = rawPlatform && rawPlatform !== 'all' ? parsePlatform(rawPlatform) : null;
  if (rawPlatform && rawPlatform !== 'all' && platform === null) {
    return NextResponse.json({ error: 'Invalid platform filter' }, { status: 400 });
  }

  const rawAction = searchParams.get('action');
  let action: ValidAction | null = null;
  if (rawAction && rawAction !== 'all') {
    if (!isValidAction(rawAction)) {
      return NextResponse.json(
        { error: `Invalid action filter. Must be one of: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 },
      );
    }
    action = rawAction;
  }

  const rawBundleVersion = searchParams.get('bundle');
  const bundleVersion =
    rawBundleVersion && rawBundleVersion !== 'all' ? rawBundleVersion.slice(0, 64) : null;

  const hasExactChannel = searchParams.has('channelExact');
  const rawChannel = searchParams.get(hasExactChannel ? 'channelExact' : 'channel');
  const channel = hasExactChannel
    ? rawChannel?.trim() || null
    : !rawChannel || rawChannel === 'all'
      ? undefined
      : rawChannel.trim() === 'base'
        ? null
        : rawChannel.trim();
  // Keep the existing `channel=base` alias for callers while allowing MCP to
  // distinguish an exact named "base" channel through additive channelExact.
  if (channel && !isValidChannelName(channel)) {
    return NextResponse.json({ error: 'Invalid channel filter' }, { status: 400 });
  }

  const rawRuntime = searchParams.get('runtime');
  const runtimeVersion =
    !searchParams.has('runtime') || rawRuntime === 'all' ? undefined : rawRuntime?.trim() || null;
  if (runtimeVersion && !isValidRuntimeVersion(runtimeVersion)) {
    return NextResponse.json({ error: 'Invalid runtime filter' }, { status: 400 });
  }

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
