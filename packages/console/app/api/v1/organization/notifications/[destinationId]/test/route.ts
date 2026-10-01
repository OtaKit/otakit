import { NextRequest, NextResponse } from 'next/server';

import { notificationsAccess } from '@/lib/notifications/http';
import { serviceErrorResponse } from '@/lib/services/http';
import { sendTestNotification } from '@/lib/services/notifications';

export const runtime = 'nodejs';

/** Send a test notification now and return the delivery with its outcome. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ destinationId: string }> },
) {
  const access = await notificationsAccess();
  if (access instanceof NextResponse) return access;
  const { destinationId } = await params;
  try {
    return NextResponse.json({ delivery: await sendTestNotification(access, destinationId) });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
