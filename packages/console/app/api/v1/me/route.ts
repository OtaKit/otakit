import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const user = session.user as { id: string; email: string; name: string };
  const userRow = await db.user.findUnique({
    where: { id: user.id },
    select: { activeOrganizationId: true },
  });

  const memberships = await db.organizationMember.findMany({
    where: { userId: user.id },
    include: { organization: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      activeOrganizationId: userRow?.activeOrganizationId ?? null,
    },
    memberships: memberships.map((m) => ({
      id: m.id,
      organizationId: m.organization.id,
      organizationName: m.organization.name,
      role: m.role,
    })),
  });
}
