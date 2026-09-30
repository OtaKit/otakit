import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { endExpiredPreviews } from '@/lib/services/previews';

export const runtime = 'nodejs';
export const maxDuration = 300;

function safeEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

// Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET`; POST is kept for
// manual runs and other schedulers.
function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return process.env.NODE_ENV !== 'production';
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : request.nextUrl.searchParams.get('secret');
  return Boolean(token) && safeEquals(token as string, cronSecret);
}

/** Delete the manifests of expired preview links. */
async function run(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized cron call' }, { status: 401 });
  }
  const stats = await endExpiredPreviews();
  return NextResponse.json({ success: true, ...stats });
}

export const GET = run;
export const POST = run;
