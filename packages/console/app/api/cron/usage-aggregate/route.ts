import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { runUsageAggregationCron } from '@/lib/billing/usage';

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

function isAuthorized(authHeader: string | null): boolean {
  const token = getBearerToken(authHeader);
  if (!token) return false;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return safeEquals(token, cronSecret);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request.headers.get('Authorization'))) {
    return NextResponse.json({ error: 'Unauthorized cron call' }, { status: 401 });
  }

  const stats = await runUsageAggregationCron();
  return NextResponse.json({ success: true, stats });
}
