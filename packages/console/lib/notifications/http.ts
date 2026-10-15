import { NextResponse } from 'next/server';

import { sessionActor } from '@/lib/audit-log';
import type { NotificationsContext } from '@/lib/services/notifications';
import { getSessionContext } from '@/lib/session';

/** Notification settings are for owners and admins, from the dashboard. */
export async function notificationsAccess(): Promise<NotificationsContext | NextResponse> {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only owners and admins can manage notifications' },
      { status: 403 },
    );
  }
  return { organizationId: ctx.organizationId, actor: sessionActor(ctx) };
}

/**
 * Members can see where notifications go (read-only, without URLs), so they
 * know why they receive email. Owners and admins see and manage everything.
 */
export async function notificationsReadAccess(): Promise<
  (NotificationsContext & { canManage: boolean }) | NextResponse
> {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return {
    organizationId: ctx.organizationId,
    actor: sessionActor(ctx),
    canManage: ctx.role === 'owner' || ctx.role === 'admin',
  };
}

export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

export function invalidBody(): NextResponse {
  return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
}
