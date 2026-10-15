import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/lib/cron-auth';
import { runTelemetryCron } from '@/lib/telemetry-cron';
import { scheduleNotificationDelivery } from '@/lib/notifications/deliver';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Sync error issues, send error alerts and enforce the monthly caps of errors and events (every 5 minutes). */
async function run(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized cron call' }, { status: 401 });
  }
  const stats = await runTelemetryCron();
  if (stats.queued > 0) scheduleNotificationDelivery();
  return NextResponse.json({ success: true, ...stats });
}

export const GET = run;
export const POST = run;
