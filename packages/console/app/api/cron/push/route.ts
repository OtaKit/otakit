import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/lib/cron-auth';
import { push } from '@/lib/push/service';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function run(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized cron call' }, { status: 401 });
  }
  const stats = await push.deliverDueBatches();
  return NextResponse.json({ success: true, ...stats });
}

export const GET = run;
export const POST = run;
