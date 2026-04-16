import { NextRequest, NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/session';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { memberId } = await params;

  const member = await db.organizationMember.findFirst({
    where: { id: memberId, organizationId: ctx.organizationId },
    select: { id: true, organizationId: true, userId: true, role: true },
  });

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  if (member.role === 'owner') {
    return NextResponse.json({ error: 'Cannot remove the owner' }, { status: 400 });
  }

  // Hard-delete the membership
  await db.organizationMember.delete({ where: { id: memberId } });
  console.log(
    JSON.stringify({
      audit: 'member_removed',
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      targetMemberId: memberId,
      targetUserId: member.userId,
      timestamp: new Date().toISOString(),
    }),
  );

  // If removed user's default organization was this one, switch to another
  const user = await db.user.findUnique({
    where: { id: member.userId },
    select: { activeOrganizationId: true },
  });

  if (user?.activeOrganizationId === ctx.organizationId) {
    const nextMembership = await db.organizationMember.findFirst({
      where: { userId: member.userId },
      select: { organizationId: true },
    });
    await db.user.update({
      where: { id: member.userId },
      data: { activeOrganizationId: nextMembership?.organizationId ?? null },
    });
  }

  return NextResponse.json({ removed: memberId });
}
