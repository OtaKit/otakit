import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/lib/cron-auth';
import { deliverDueNotifications, pruneNotificationDeliveries } from '@/lib/notifications/deliver';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Retry due notification deliveries and prune old delivery records. */
async function run(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized cron call' }, { status: 401 });
  }
  // Stop claiming before the next minute's run starts.
  const stats = await deliverDueNotifications({ budgetMs: 50_000 });
  const pruned = await pruneNotificationDeliveries();
  return NextResponse.json({ success: true, ...stats, pruned });
}

export const GET = run;
export const POST = run;
