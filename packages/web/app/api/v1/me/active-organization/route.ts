import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const organizationId = body.organizationId;
  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    return NextResponse.json({ error: 'organizationId is required' }, { status: 400 });
  }

  const membership = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: session.user.id } },
  });
  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 });
  }

  await db.user.update({
    where: { id: session.user.id },
    data: { activeOrganizationId: organizationId },
  });

  return NextResponse.json({ activeOrganizationId: organizationId });
}
