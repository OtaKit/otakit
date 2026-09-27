import { isPushError, type PushAppRef } from '@otakit/push-server';
import { NextRequest, NextResponse } from 'next/server';

import { accessActor, recordAuditLog, type AuditAction } from '@/lib/audit-log';
import { db } from '@/lib/db';
import { resolveOrganizationAccess, type OrganizationAccess } from '@/lib/organization-access';
import { checkRateLimit } from '@/lib/rate-limit';
import { organizationAccessErrorResponse, serviceErrorResponse } from '@/lib/services/http';

export const PUSH_DISABLED_NEXT_STEP =
  'An owner or admin can turn on Push notifications in Settings → Add-ons.';

type PushAccess = { ok: true; access: OrganizationAccess } | { ok: false; response: NextResponse };

/** Dashboard/API routes: the caller must reach the app and the workspace must have push on. */
export async function requirePushAccess(request: NextRequest, appId: string): Promise<PushAccess> {
  const result = await resolveOrganizationAccess(request, appId);
  if (!result.success) return { ok: false, response: organizationAccessErrorResponse(result) };
  const organization = await db.organization.findUnique({
    where: { id: result.access.organizationId },
    select: { pushEnabled: true },
  });
  if (!organization?.pushEnabled) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Push notifications are not enabled for this workspace.',
          code: 'PUSH_DISABLED',
          nextStep: PUSH_DISABLED_NEXT_STEP,
        },
        { status: 403 },
      ),
    };
  }
  return { ok: true, access: result.access };
}

/** Credentials are secrets: only owners and admins signed in to the dashboard manage them. */
export function pushAdminError(access: OrganizationAccess): NextResponse | null {
  if (access.actorType === 'user' && (access.role === 'owner' || access.role === 'admin')) {
    return null;
  }
  return NextResponse.json(
    {
      error: 'Only organization owners and admins can manage push credentials.',
      code: 'INSUFFICIENT_ROLE',
    },
    { status: 403 },
  );
}

export function pushErrorResponse(error: unknown): NextResponse {
  if (isPushError(error)) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.nextStep ? { nextStep: error.nextStep } : {}),
      },
      { status: error.status },
    );
  }
  return serviceErrorResponse(error);
}

export async function pushActorLabel(access: OrganizationAccess): Promise<string> {
  return (await accessActor(access)).actorLabel;
}

export async function auditPush(
  access: OrganizationAccess,
  action: Extract<AuditAction, `push_${string}`>,
  target: { type: string; id: string },
  metadata: Record<string, unknown>,
): Promise<void> {
  await recordAuditLog({
    organizationId: access.organizationId,
    actor: await accessActor(access),
    action,
    targetType: target.type,
    targetId: target.id,
    metadata,
  });
}

// ── Public device endpoints (called by apps, no auth) ─────────────────────

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

/**
 * Resolves the app of a public device request. A workspace without the add-on gets
 * `{ accepted: false }` (202), which the helper in the app reports without failing.
 */
export async function resolvePublicPushApp(
  appId: string,
): Promise<{ ok: true; app: PushAppRef } | { ok: false; response: NextResponse }> {
  const app = /^[0-9a-f-]{36}$/i.test(appId)
    ? await db.app.findUnique({
        where: { id: appId },
        select: { id: true, organizationId: true, organization: { select: { pushEnabled: true } } },
      })
    : null;
  if (!app) return { ok: false, response: publicJson({ error: 'App not found' }, 404) };
  if (!app.organization.pushEnabled) {
    return { ok: false, response: publicJson({ accepted: false, reason: 'push_disabled' }, 202) };
  }
  return { ok: true, app: { appId: app.id, organizationId: app.organizationId } };
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
