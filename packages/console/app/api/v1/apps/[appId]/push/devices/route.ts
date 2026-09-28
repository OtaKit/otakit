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
    const params = request.nextUrl.searchParams;
    const [overview, devices, usage] = await Promise.all([
      push.getDeviceOverview(appId),
      push.listDevices({
        appId,
        search: params.get('search'),
        platform: params.get('platform'),
        channel: params.get('channel'),
        limit: Number(params.get('limit') ?? 50),
      }),
      push.getUsage(gate.access.organizationId),
    ]);
    return NextResponse.json({ overview, devices, usage });
  } catch (error) {
    return pushErrorResponse(error);
  }
}
