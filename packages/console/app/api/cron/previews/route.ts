import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/lib/cron-auth';
import { endExpiredPreviews } from '@/lib/services/previews';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Delete the manifests of expired preview links. */
async function run(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized cron call' }, { status: 401 });
  }
  const stats = await endExpiredPreviews();
  return NextResponse.json({ success: true, ...stats });
}

export const GET = run;
export const POST = run;
