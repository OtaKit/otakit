import { NextRequest, NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/session';
import { db } from '@/lib/db';
import { generateOrganizationApiKey } from '@/lib/organization-keys';
import { recordAuditLog, sessionActor } from '@/lib/audit-log';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const rawName = body.name;
  const keyName =
    typeof rawName === 'string' && rawName.trim().length >= 1 && rawName.trim().length <= 120
      ? rawName.trim()
      : 'default';

  const generated = generateOrganizationApiKey();
  const key = await db.organizationApiKey.create({
    data: {
      organizationId: ctx.organizationId,
      name: keyName,
      keyHash: generated.keyHash,
      keyPrefix: generated.keyPrefix,
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      createdAt: true,
    },
  });
  await recordAuditLog({
    organizationId: ctx.organizationId,
    actor: sessionActor(ctx),
    action: 'api_key.created',
    targetType: 'api_key',
    targetId: key.id,
    metadata: { keyName: key.name, keyPrefix: key.keyPrefix },
  });

  return NextResponse.json(
    {
      apiKey: {
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        createdAt: key.createdAt.toISOString(),
      },
      secretKey: generated.rawKey,
    },
    { status: 201 },
  );
}
