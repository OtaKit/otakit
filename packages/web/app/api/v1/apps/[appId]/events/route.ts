import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { isValidChannelName, parseNonNegativeInteger, parsePlatform } from '@/lib/validation';

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
  const action = rawAction && rawAction !== 'all' ? rawAction : null;
  if (action && !isValidAction(action)) {
    return NextResponse.json(
      { error: `Invalid action filter. Must be one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }

  const rawBundleVersion = searchParams.get('bundle');
  const bundleVersion =
    rawBundleVersion && rawBundleVersion !== 'all' ? rawBundleVersion.slice(0, 64) : null;

  const rawChannel = searchParams.get('channel');
  const channel = rawChannel && rawChannel !== 'all' ? rawChannel.trim() : null;
  if (channel && !isValidChannelName(channel)) {
    return NextResponse.json({ error: 'Invalid channel filter' }, { status: 400 });
  }

  const rawReleaseId = searchParams.get('releaseId');
  const releaseId = rawReleaseId && rawReleaseId !== 'all' ? rawReleaseId.trim() : null;
  if (releaseId && releaseId.length > 64) {
    return NextResponse.json({ error: 'Invalid releaseId filter' }, { status: 400 });
  }

  const rawTimeframe = searchParams.get('timeframe') ?? '24h';
  const timeframeMs = TIMEFRAME_TO_MS[rawTimeframe];
  if (!timeframeMs) {
    return NextResponse.json(
      {
        error: `Invalid timeframe filter. Must be one of: ${Object.keys(TIMEFRAME_TO_MS).join(', ')}`,
      },
      { status: 400 },
    );
  }

  const limit = Math.max(1, Math.min(parseNonNegativeInteger(searchParams.get('limit'), 50), 200));
  const createdAtFrom = new Date(Date.now() - timeframeMs);

  const events = await db.deviceEvent.findMany({
    where: {
      appId,
      createdAt: { gte: createdAtFrom },
      ...(platform ? { platform } : {}),
      ...(action ? { action } : {}),
      ...(bundleVersion ? { bundleVersion } : {}),
      ...(channel ? { channel } : {}),
      ...(releaseId ? { releaseId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return NextResponse.json({
    events: events.map((event) => ({
      id: event.id,
      appId,
      action: event.action,
      platform: event.platform,
      bundleVersion: event.bundleVersion,
      channel: event.channel,
      releaseId: event.releaseId,
      errorMessage: event.errorMessage,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}
