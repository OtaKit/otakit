import { NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/session';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const members = await db.organizationMember.findMany({
    where: { organizationId: ctx.organizationId },
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
