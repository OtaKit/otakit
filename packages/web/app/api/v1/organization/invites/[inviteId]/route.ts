import { NextRequest, NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/session';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ inviteId: string }> },
) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { inviteId } = await params;

  const invite = await db.organizationInvite.findUnique({
    where: { id: inviteId },
    select: { id: true, organizationId: true, acceptedAt: true },
  });

  if (!invite || invite.organizationId !== ctx.organizationId) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  }

  if (invite.acceptedAt !== null) {
    return NextResponse.json({ error: 'Invite already accepted' }, { status: 400 });
  }

  await db.organizationInvite.delete({ where: { id: inviteId } });

  return NextResponse.json({ deleted: inviteId });
}
