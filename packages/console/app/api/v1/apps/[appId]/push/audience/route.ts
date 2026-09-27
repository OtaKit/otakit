import { NextRequest, NextResponse } from 'next/server';

import { pushErrorResponse, requirePushAccess } from '@/lib/push/http';
import { push } from '@/lib/push/service';

export const runtime = 'nodejs';

/** Validates a message and counts who would receive it. Sends nothing. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const gate = await requirePushAccess(request, appId);
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  try {
    return NextResponse.json(
      await push.previewCampaign({ appId, payload: body.payload, audience: body.audience }),
    );
  } catch (error) {
    return pushErrorResponse(error);
  }
}
