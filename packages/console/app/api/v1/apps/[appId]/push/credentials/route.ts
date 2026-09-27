import { NextRequest, NextResponse } from 'next/server';

import { pushErrorResponse, requirePushAccess } from '@/lib/push/http';
import { push } from '@/lib/push/service';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const gate = await requirePushAccess(request, appId);
  if (!gate.ok) return gate.response;

  try {
    return NextResponse.json({ credentials: await push.listCredentials(appId) });
  } catch (error) {
    return pushErrorResponse(error);
  }
}
