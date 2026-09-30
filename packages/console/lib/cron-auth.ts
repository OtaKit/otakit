import crypto from 'node:crypto';

import type { NextRequest } from 'next/server';

function safeEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

/**
 * Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET`; `?secret=` is kept for manual
 * runs and other schedulers. Without CRON_SECRET only non-production builds are open.
 */
export function isCronAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return process.env.NODE_ENV !== 'production';
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : request.nextUrl.searchParams.get('secret');
  return Boolean(token) && safeEquals(token as string, cronSecret);
}
