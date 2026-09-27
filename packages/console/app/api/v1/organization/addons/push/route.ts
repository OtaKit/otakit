import { NextRequest, NextResponse } from 'next/server';

import { recordAuditLog, sessionActor } from '@/lib/audit-log';
import { db } from '@/lib/db';
import { getSessionContext } from '@/lib/session';

export const runtime = 'nodejs';

/** Turns the push notifications add-on on or off for the active workspace. */
export async function PUT(request: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'Invalid body. Expected { enabled: boolean }.' },
      { status: 400 },
    );
  }

  const organization = await db.organization.update({
    where: { id: ctx.organizationId },
    data: { pushEnabled: body.enabled },
    select: { pushEnabled: true },
  });
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actor: sessionActor(ctx),
    action: body.enabled ? 'organization.push_enabled' : 'organization.push_disabled',
    targetType: 'organization',
    targetId: ctx.organizationId,
  });
  return NextResponse.json({ pushEnabled: organization.pushEnabled });
}
