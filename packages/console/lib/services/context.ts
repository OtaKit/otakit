import { db } from '@/lib/db';
import type { OrganizationAccess } from '@/lib/organization-access';
import { resolveReleaseActor } from '@/lib/release-audit';
import { isReleaseReliabilityEnabled } from '@/lib/release-features';
import { isTinybirdConfigured } from '@/lib/tinybird/client';

import { OtaKitServiceError } from './errors';

export async function getConnectionContext(access: OrganizationAccess) {
  const organization = await db.organization.findUnique({
    where: { id: access.organizationId },
    select: { id: true, name: true },
  });
  if (!organization) {
    throw new OtaKitServiceError('ORGANIZATION_NOT_FOUND', 'Organization not found', 404);
  }

  return {
    organization,
    actor: {
      type: access.actorType,
      id: access.actorId,
      label: await resolveReleaseActor(access),
      role: access.role ?? null,
    },
    capabilities: {
      analytics: isTinybirdConfigured(),
      organizationKey: access.actorType === 'key',
      releaseReliability: isReleaseReliabilityEnabled(),
    },
  };
}
