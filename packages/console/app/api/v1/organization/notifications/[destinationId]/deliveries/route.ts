import { NextRequest, NextResponse } from 'next/server';

import { notificationsAccess } from '@/lib/notifications/http';
import { serviceErrorResponse } from '@/lib/services/http';
import { listNotificationDeliveries } from '@/lib/services/notifications';

export const runtime = 'nodejs';

/** The destination's 50 most recent deliveries. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ destinationId: string }> },
) {
  const access = await notificationsAccess();
  if (access instanceof NextResponse) return access;
  const { destinationId } = await params;
  try {
    return NextResponse.json({
      deliveries: await listNotificationDeliveries(access.organizationId, destinationId),
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
