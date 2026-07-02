import { headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { recordAuditLog } from '@/lib/audit-log';

export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { organizationId } = await params;

  const membership = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: session.user.id,
      },
    },
    select: { role: true },
  });

  if (!membership) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
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

  const existing = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });

  const organization = await db.organization.update({
    where: { id: organizationId },
    data: { name },
    select: { id: true, name: true },
  });

  await recordAuditLog({
    organizationId,
    actor: { actorType: 'user', actorId: session.user.id, actorLabel: session.user.email },
    action: 'organization.renamed',
    targetType: 'organization',
    targetId: organizationId,
    metadata: { oldName: existing?.name, newName: organization.name },
  });

  return NextResponse.json({ organization });
}
