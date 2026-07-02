import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { runAutoRevertSweep } from '@/lib/auto-revert';

export const runtime = 'nodejs';

function getBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

function safeEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

/**
 * CRON_SECRET is optional here: unset means the endpoint is open (the sweep
 * is idempotent and can only revert releases whose own thresholds trip).
 * When set, the secret is accepted as a Bearer header or a ?secret= query
 * param — some schedulers (e.g. NextMQ cron) can only call a bare URL.
 */
function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;

  const token =
    getBearerToken(request.headers.get('Authorization')) ??
    request.nextUrl.searchParams.get('secret');
  if (!token) return false;
  return safeEquals(token, cronSecret);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized cron call' }, { status: 401 });
  }

  const stats = await runAutoRevertSweep();
  return NextResponse.json({ success: true, stats });
}
