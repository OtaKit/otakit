import type { PrismaClient } from '@prisma/client';

import { db } from '@/lib/db';

import { isOtaKitOAuthScope } from './features';
import {
  normalizeOAuthOrganizationId,
  OTAKIT_OAUTH_ORGANIZATION_HEADER,
} from './oauth-organization-shared';

type OAuthOrganizationDatabase = Pick<PrismaClient, 'organizationMember'>;

export async function selectedOAuthOrganizationId(
  userId: string,
  requestHeaders: Headers,
  database: OAuthOrganizationDatabase = db,
): Promise<string | undefined> {
  const organizationId = normalizeOAuthOrganizationId(
    requestHeaders.get(OTAKIT_OAUTH_ORGANIZATION_HEADER),
  );
  if (!organizationId) return undefined;

  const membership = await database.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId, userId },
    },
    select: { organizationId: true },
  });
  return membership?.organizationId;
}

export async function shouldSelectOAuthOrganization(
  userId: string,
  scopes: readonly string[],
  requestHeaders: Headers,
  database: OAuthOrganizationDatabase = db,
): Promise<boolean> {
  return scopes.some(isOtaKitOAuthScope)
    ? (await selectedOAuthOrganizationId(userId, requestHeaders, database)) === undefined
    : false;
}
