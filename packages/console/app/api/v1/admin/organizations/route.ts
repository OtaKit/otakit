import { NextRequest, NextResponse } from 'next/server';

import { verifyGlobalAdminAuth } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { generateOrganizationApiKey } from '@/lib/organization-keys';

export const runtime = 'nodejs';

function parseOrganizationName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 120) return null;
  return normalized;
}

function parseKeyName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 120) return fallback;
  return normalized;
}

export async function GET(request: NextRequest) {
  const auth = verifyGlobalAdminAuth(request.headers.get('Authorization'));
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const organizations = await db.organization.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: {
          apps: true,
          apiKeys: true,
        },
      },
      apiKeys: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          createdAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      },
    },
  });

  return NextResponse.json({
    organizations: organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      createdAt: organization.createdAt.toISOString(),
      appCount: organization._count.apps,
      keyCount: organization._count.apiKeys,
      apiKeys: organization.apiKeys.map((key) => ({
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        createdAt: key.createdAt.toISOString(),
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        revokedAt: key.revokedAt?.toISOString() ?? null,
      })),
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = verifyGlobalAdminAuth(request.headers.get('Authorization'));
  if (!auth.success) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const organizationName = parseOrganizationName(body.name);
  if (!organizationName) {
    return NextResponse.json({ error: 'name is required (2-120 chars)' }, { status: 400 });
  }

  const keyName = parseKeyName(body.keyName, 'default');
  const generated = generateOrganizationApiKey();

  const created = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: organizationName },
      select: {
        id: true,
        name: true,
        createdAt: true,
      },
    });

    const key = await tx.organizationApiKey.create({
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

    return { organization, key };
  });

  return NextResponse.json(
    {
      organization: {
        id: created.organization.id,
        name: created.organization.name,
        createdAt: created.organization.createdAt.toISOString(),
      },
      apiKey: {
        id: created.key.id,
        name: created.key.name,
        keyPrefix: created.key.keyPrefix,
        createdAt: created.key.createdAt.toISOString(),
      },
      secretKey: generated.rawKey,
    },
    { status: 201 },
  );
}
