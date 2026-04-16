import { NextRequest, NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/session';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> },
) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { keyId } = await params;

  const existing = await db.organizationApiKey.findUnique({
    where: { id: keyId },
    select: { id: true, organizationId: true, revokedAt: true },
  });

  if (!existing || existing.organizationId !== ctx.organizationId) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 });
  }

  if (existing.revokedAt) {
    return NextResponse.json({
      id: existing.id,
      revokedAt: existing.revokedAt.toISOString(),
    });
  }

  const revoked = await db.organizationApiKey.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
    select: { id: true, revokedAt: true },
  });
  console.log(
    JSON.stringify({
      audit: 'api_key_revoked',
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      keyId: revoked.id,
      timestamp: new Date().toISOString(),
    }),
  );

  return NextResponse.json({
    id: revoked.id,
    revokedAt: revoked.revokedAt?.toISOString() ?? null,
  });
}
