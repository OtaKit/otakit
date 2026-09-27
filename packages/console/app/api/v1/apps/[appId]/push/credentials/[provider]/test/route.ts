import { NextRequest, NextResponse } from 'next/server';

import { pushAdminError, pushErrorResponse, requirePushAccess } from '@/lib/push/http';
import { push } from '@/lib/push/service';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; provider: string }> },
) {
  const { appId, provider } = await params;
  if (provider !== 'apns' && provider !== 'fcm') {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
  }
  const gate = await requirePushAccess(request, appId);
  if (!gate.ok) return gate.response;
  const forbidden = pushAdminError(gate.access);
  if (forbidden) return forbidden;

  try {
    return NextResponse.json(await push.testCredential({ appId, provider }));
  } catch (error) {
    return pushErrorResponse(error);
  }
}
