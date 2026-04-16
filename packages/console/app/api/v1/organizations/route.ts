import { headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) {
    return NextResponse.json(
      { error: 'Organization name is required (max 100 chars)' },
      { status: 400 },
    );
  }

  const organization = await db.$transaction(async (tx) => {
    const t = await tx.organization.create({ data: { name } });

    await tx.organizationMember.create({
      data: { organizationId: t.id, userId: session.user.id, role: 'owner' },
    });

    await tx.user.update({
      where: { id: session.user.id },
      data: { activeOrganizationId: t.id },
    });

    return t;
  });

  return NextResponse.json(
    { organization: { id: organization.id, name: organization.name } },
    { status: 201 },
  );
}
