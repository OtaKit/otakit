import { NextRequest, NextResponse } from 'next/server';

import { invalidBody, jsonBody, notificationsAccess } from '@/lib/notifications/http';
import { serviceErrorResponse } from '@/lib/services/http';
import {
  deleteNotificationDestination,
  updateNotificationDestination,
} from '@/lib/services/notifications';

export const runtime = 'nodejs';

type Params = { params: Promise<{ destinationId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const access = await notificationsAccess();
  if (access instanceof NextResponse) return access;
  const body = await jsonBody(request);
  if (!body) return invalidBody();
  const { destinationId } = await params;
  try {
    return NextResponse.json({
      destination: await updateNotificationDestination(access, destinationId, body),
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const access = await notificationsAccess();
  if (access instanceof NextResponse) return access;
  const { destinationId } = await params;
  try {
    await deleteNotificationDestination(access, destinationId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
