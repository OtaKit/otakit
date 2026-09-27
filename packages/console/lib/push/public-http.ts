import { NextRequest, NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/rate-limit';

// Capacitor apps call these endpoints from capacitor://localhost, https://localhost
// or a custom hostname. No cookies are involved, so any origin is allowed.
export const PUBLIC_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Id',
  'Access-Control-Max-Age': '86400',
} as const;

export function publicJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...PUBLIC_CORS_HEADERS, ...headers } });
}

export function publicPreflight() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

/** Per-IP and per-app limits for the unauthenticated device endpoints. */
export async function limitPublicPushRequest(
  request: NextRequest,
  appId: string,
): Promise<NextResponse | null> {
  const [byIp, byApp] = await Promise.all([
    checkRateLimit('push-devices-ip', clientIp(request), 30, 60),
    checkRateLimit('push-devices-app', appId, 1000, 60),
  ]);
  if (byIp.allowed && byApp.allowed) return null;
  return publicJson({ error: 'Too many requests' }, 429, { 'Retry-After': '60' });
}

export async function readJsonObject(
  request: NextRequest,
): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
