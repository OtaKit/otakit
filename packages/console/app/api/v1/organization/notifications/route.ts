import { NextRequest, NextResponse } from 'next/server';

import { invalidBody, jsonBody, notificationsAccess } from '@/lib/notifications/http';
import { serviceErrorResponse } from '@/lib/services/http';
import {
  createNotificationDestination,
  listNotificationSettings,
} from '@/lib/services/notifications';

export const runtime = 'nodejs';

export async function GET() {
  const access = await notificationsAccess();
  if (access instanceof NextResponse) return access;
  try {
    return NextResponse.json(await listNotificationSettings(access.organizationId));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const access = await notificationsAccess();
  if (access instanceof NextResponse) return access;
  const body = await jsonBody(request);
  if (!body) return invalidBody();
  try {
    return NextResponse.json(await createNotificationDestination(access, body), { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
