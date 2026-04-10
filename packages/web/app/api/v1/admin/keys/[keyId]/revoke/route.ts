import { NextRequest, NextResponse } from 'next/server';

import { verifyGlobalAdminAuth } from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> },
) {
  const auth = verifyGlobalAdminAuth(request.headers.get('Authorization'));
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const routeParams = await params;

  const existing = await db.organizationApiKey.findUnique({
    where: { id: routeParams.keyId },
    select: {
      id: true,
      revokedAt: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 });
  }
  if (existing.revokedAt) {
    return NextResponse.json(
      {
        id: existing.id,
        revokedAt: existing.revokedAt.toISOString(),
      },
      { status: 200 },
    );
  }

  const revoked = await db.organizationApiKey.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
    select: {
      id: true,
      revokedAt: true,
    },
  });

  return NextResponse.json({
    id: revoked.id,
    revokedAt: revoked.revokedAt?.toISOString() ?? null,
  });
}
