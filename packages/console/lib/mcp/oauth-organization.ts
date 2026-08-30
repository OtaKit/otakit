import type { PrismaClient } from '@prisma/client';

import { db } from '@/lib/db';

import { isOtaKitOAuthScope } from './features';

type OAuthOrganizationDatabase = Pick<PrismaClient, 'user'>;

export async function activeOAuthOrganizationId(
  userId: string,
  database: OAuthOrganizationDatabase = db,
): Promise<string | undefined> {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: {
      activeOrganizationId: true,
      memberships: { select: { organizationId: true } },
    },
  });
  const organizationId = user?.activeOrganizationId ?? undefined;
  return organizationId &&
    user?.memberships.some((membership) => membership.organizationId === organizationId)
    ? organizationId
    : undefined;
}

export async function shouldSelectOAuthOrganization(
  userId: string,
  scopes: readonly string[],
  database: OAuthOrganizationDatabase = db,
): Promise<boolean> {
  return scopes.some(isOtaKitOAuthScope)
    ? (await activeOAuthOrganizationId(userId, database)) === undefined
    : false;
}
