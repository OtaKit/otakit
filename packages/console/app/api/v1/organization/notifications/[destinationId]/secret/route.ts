import { NextRequest, NextResponse } from 'next/server';

import { notificationsAccess } from '@/lib/notifications/http';
import { serviceErrorResponse } from '@/lib/services/http';
import { revealWebhookSecret, rotateWebhookSecret } from '@/lib/services/notifications';

export const runtime = 'nodejs';

type Params = { params: Promise<{ destinationId: string }> };

/** The webhook's signing secret. */
export async function GET(_request: NextRequest, { params }: Params) {
  const access = await notificationsAccess();
  if (access instanceof NextResponse) return access;
  const { destinationId } = await params;
  try {
    return NextResponse.json(
      { secret: await revealWebhookSecret(access.organizationId, destinationId) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

/** Rotate the signing secret; the old one keeps signing for 24 hours. */
export async function POST(_request: NextRequest, { params }: Params) {
  const access = await notificationsAccess();
  if (access instanceof NextResponse) return access;
  const { destinationId } = await params;
  try {
    return NextResponse.json(
      { secret: await rotateWebhookSecret(access, destinationId) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
