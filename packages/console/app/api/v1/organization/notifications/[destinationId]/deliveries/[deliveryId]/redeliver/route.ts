import { NextRequest, NextResponse } from 'next/server';

import { notificationsAccess } from '@/lib/notifications/http';
import { serviceErrorResponse } from '@/lib/services/http';
import { redeliverNotification } from '@/lib/services/notifications';

export const runtime = 'nodejs';

/** Attempt the delivery again now. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ destinationId: string; deliveryId: string }> },
) {
  const access = await notificationsAccess();
  if (access instanceof NextResponse) return access;
  const { destinationId, deliveryId } = await params;
  try {
    return NextResponse.json({
      delivery: await redeliverNotification(access.organizationId, destinationId, deliveryId),
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
