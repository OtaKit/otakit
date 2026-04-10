import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { db } from '@/lib/db';
import { isValidAppSlug } from '@/lib/validation';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const access = await resolveOrganizationAccess(request);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawSlug = body.slug;
  if (typeof rawSlug !== 'string') {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
  }

  const slug = rawSlug.trim();
  if (!isValidAppSlug(slug)) {
    return NextResponse.json(
      {
        error: 'Invalid slug. Use 3-120 chars: letters, numbers, dot, underscore, hyphen',
      },
      { status: 400 },
    );
  }

  try {
    const app = await db.app.create({
      data: {
        organizationId: access.access.organizationId,
        slug,
      },
      select: {
        id: true,
        slug: true,
        createdAt: true,
      },
    });

    return NextResponse.json(
      {
        id: app.id,
        slug: app.slug,
        createdAt: app.createdAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = String((error.meta as { target?: unknown })?.target ?? '');
      if (target.includes('organizationId') || target.includes('slug')) {
        return NextResponse.json(
          { error: 'Slug already exists for this organization' },
          { status: 409 },
        );
      }
    }

    const message = error instanceof Error ? error.message : 'Create app failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
