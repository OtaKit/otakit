import { NextRequest, NextResponse } from 'next/server';

import { pushErrorResponse, requirePushAccess } from '@/lib/push/http';
import { push } from '@/lib/push/service';

export const runtime = 'nodejs';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; deviceId: string }> },
) {
  const { appId, deviceId } = await params;
  const gate = await requirePushAccess(request, appId);
  if (!gate.ok) return gate.response;
  try {
    await push.deleteDevice(appId, deviceId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return pushErrorResponse(error);
  }
}
