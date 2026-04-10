import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import type { DashboardInitialData } from '@/app/components/dashboard-types';

async function getUserContext() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect('/login');
  }

  const userRow = await db.user.findUnique({
    where: { id: session.user.id },
    select: { activeOrganizationId: true },
  });

  const memberships = await db.organizationMember.findMany({
    where: { userId: session.user.id },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (memberships.length === 0) {
    redirect('/login');
  }

  const activeOrganizationId = userRow?.activeOrganizationId;
  const activeMembership =
    memberships.find((membership) => membership.organizationId === activeOrganizationId) ??
    memberships[0];

  return {
    session,
    memberships,
    activeMembership,
  };
}

async function getOrganizationData(organizationId: string) {
  const apps = await db.app.findMany({
    where: { organizationId },
    select: {
      id: true,
      slug: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
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

  return {
    apps,
    organization,
  };
}

export async function getDashboardInitialData(): Promise<DashboardInitialData> {
  const { session, memberships, activeMembership } = await getUserContext();
  const organizationData = await getOrganizationData(activeMembership.organizationId);

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    activeOrganization: {
      id: activeMembership.organization.id,
      name: activeMembership.organization.name,
      role: activeMembership.role,
    },
    memberships: memberships.map((membership) => ({
      id: membership.id,
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      role: membership.role,
    })),
    apps: organizationData.apps.map((app) => ({
      id: app.id,
      slug: app.slug,
      createdAt: app.createdAt.toISOString(),
      bundleCount: 0,
    })),
    organizationApiKeys:
      organizationData.organization?.apiKeys.map((apiKey) => ({
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        createdAt: apiKey.createdAt.toISOString(),
        lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
        revokedAt: apiKey.revokedAt?.toISOString() ?? null,
      })) ?? [],
  };
}
