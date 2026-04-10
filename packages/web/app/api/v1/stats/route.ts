import { NextRequest, NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/rate-limit';
import { db } from '@/lib/db';
import { parsePlatform } from '@/lib/validation';

export const runtime = 'nodejs';

const VALID_ACTIONS = ['downloaded', 'applied', 'download_error', 'rollback'] as const;

type ValidAction = (typeof VALID_ACTIONS)[number];

function isValidAction(value: string): value is ValidAction {
  return VALID_ACTIONS.includes(value as ValidAction);
}

export async function POST(request: NextRequest) {
  const appId = request.headers.get('X-App-Id')?.trim();
  if (!appId) {
    return NextResponse.json({ error: 'Missing X-App-Id header' }, { status: 401 });
  }

  const rl = await checkRateLimit('stats', appId, 50, 1);
  if (!rl.allowed) {
    return new NextResponse(null, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const platform = parsePlatform(body.platform);
  const action = typeof body.action === 'string' ? body.action.trim() : null;

  if (!platform) {
    return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
  }
  if (!action || !isValidAction(action)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }

  const bundleVersion = typeof body.bundleVersion === 'string' ? body.bundleVersion : null;
  const channel =
    typeof body.channel === 'string' && body.channel.trim().length > 0 ? body.channel.trim() : null;
  const releaseId = typeof body.releaseId === 'string' ? body.releaseId : null;
  const nativeBuild = typeof body.nativeBuild === 'string' ? body.nativeBuild : null;
  const errorMessage =
    typeof body.errorMessage === 'string' ? body.errorMessage.slice(0, 500) : null;

  await db.deviceEvent.create({
    data: {
      appId,
      platform,
      action,
      bundleVersion: bundleVersion?.slice(0, 64),
      channel: channel?.slice(0, 64),
      releaseId: releaseId?.slice(0, 64),
      nativeBuild: nativeBuild?.slice(0, 32),
      errorMessage,
    },
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
