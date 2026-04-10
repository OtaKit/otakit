import { NextRequest, NextResponse } from 'next/server';

import { verifyGlobalAdminAuth } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { generateOrganizationApiKey } from '@/lib/organization-keys';

export const runtime = 'nodejs';

function parseKeyName(value: unknown): string {
  if (typeof value !== 'string') return 'default';
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 120) return 'default';
  return normalized;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const auth = verifyGlobalAdminAuth(request.headers.get('Authorization'));
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const routeParams = await params;

  const organization = await db.organization.findUnique({
    where: { id: routeParams.organizationId },
    select: { id: true, name: true },
  });
  if (!organization) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const keyName = parseKeyName(body.name);

  const generated = generateOrganizationApiKey();
  const key = await db.organizationApiKey.create({
    data: {
      organizationId: organization.id,
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

  return NextResponse.json(
    {
      organization: { id: organization.id, name: organization.name },
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
