import { getOrganizationEntitlements } from '@/lib/billing/service';
import { getOrganizationUsageSnapshot } from '@/lib/billing/usage';
import { db } from '@/lib/db';
import type { OrganizationAccess } from '@/lib/organization-access';

import { OtaKitServiceError } from './errors';

function nextPeriodStart(periodStart: string): string {
  const start = new Date(periodStart);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString();
}

export async function getAccountStatus(access: OrganizationAccess) {
  if (access.actorType !== 'user') {
    throw new OtaKitServiceError(
      'INSUFFICIENT_ROLE',
      'Organization API keys do not have billing access',
      403,
      'Use an authenticated user connection to read plan and usage information.',
    );
  }

  const [organization, entitlements, usage] = await Promise.all([
    db.organization.findUnique({
      where: { id: access.organizationId },
      select: { id: true, name: true },
    }),
    getOrganizationEntitlements(access.organizationId),
    getOrganizationUsageSnapshot(access.organizationId),
  ]);
  if (!organization) {
    throw new OtaKitServiceError('ORGANIZATION_NOT_FOUND', 'Organization not found', 404);
  }

  // An empty configured value must fall through, so test truthiness, not null.
  const baseUrl = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');

  return {
    organization,
    plan: {
      key: entitlements.planKey,
      active: entitlements.isActive,
      teamMembersAvailable: entitlements.limits.teamMembers,
      overageAvailable: entitlements.limits.overage,
    },
    usage: {
      ...usage,
      periodEnd: nextPeriodStart(usage.periodStart),
    },
    links: {
      billing: `${baseUrl}/dashboard/settings?pricing=1`,
      usage: `${baseUrl}/dashboard/settings`,
    },
  };
}
