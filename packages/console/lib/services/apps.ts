import { Prisma } from '@prisma/client';

import { accessActor, recordAuditLog } from '@/lib/audit-log';
import { db } from '@/lib/db';
import type { OrganizationAccess } from '@/lib/organization-access';
import { isValidAppSlug } from '@/lib/validation';

import { OtaKitServiceError } from './errors';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export type AppSummary = {
  id: string;
  slug: string;
  createdAt: string;
};

export async function listOrganizationApps(input: {
  organizationId: string;
  slug?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ apps: AppSummary[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const slug = input.slug?.trim();
  if (slug && !isValidAppSlug(slug)) {
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'Invalid slug. Use 3-120 chars: letters, numbers, dot, underscore, hyphen',
      400,
    );
  }
  const rows = await db.app.findMany({
    where: {
      organizationId: input.organizationId,
      ...(slug ? { slug } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: { id: true, slug: true, createdAt: true },
  });

  const hasMore = rows.length > limit;
  const selected = hasMore ? rows.slice(0, limit) : rows;
  return {
    apps: selected.map((app) => ({
      id: app.id,
      slug: app.slug,
      createdAt: app.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? (selected.at(-1)?.id ?? null) : null,
  };
}

export async function createApp(input: {
  access: OrganizationAccess;
  slug: string;
  auditMetadata?: Record<string, unknown>;
}): Promise<AppSummary> {
  const slug = input.slug.trim();
  if (!isValidAppSlug(slug)) {
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'Invalid slug. Use 3-120 chars: letters, numbers, dot, underscore, hyphen',
      400,
    );
  }

  try {
    const app = await db.app.create({
      data: { organizationId: input.access.organizationId, slug },
      select: { id: true, slug: true, createdAt: true },
    });

    await recordAuditLog({
      organizationId: input.access.organizationId,
      actor: await accessActor(input.access),
      action: 'app.created',
      targetType: 'app',
      targetId: app.id,
      metadata: { slug: app.slug, ...input.auditMetadata },
    });

    return { id: app.id, slug: app.slug, createdAt: app.createdAt.toISOString() };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new OtaKitServiceError(
        'APP_SLUG_CONFLICT',
        'Slug already exists for this organization',
        409,
      );
    }
    throw error;
  }
}
