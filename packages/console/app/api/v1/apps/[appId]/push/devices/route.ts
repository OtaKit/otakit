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
    const search = request.nextUrl.searchParams.get('search');
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 50);
    const [overview, devices, usage] = await Promise.all([
      push.getDeviceOverview(appId),
      push.listDevices({ appId, search, limit }),
      push.getUsage(gate.access.organizationId),
    ]);
    return NextResponse.json({ overview, devices, usage });
  } catch (error) {
    return pushErrorResponse(error);
  }
}
