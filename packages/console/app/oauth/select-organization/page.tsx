import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { OAuthOrganizationPicker, type OrganizationChoice } from './picker';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isRemoteMcpOAuthEnabled } from '@/lib/mcp/features';
import { describeOrganization, disambiguate } from '@/lib/organization-identity';

export const dynamic = 'force-dynamic';

export default async function OAuthSelectOrganizationPage() {
  if (!isRemoteMcpOAuthEnabled()) notFound();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      activeOrganizationId: true,
      memberships: {
        orderBy: { createdAt: 'asc' },
        select: {
          role: true,
          organization: {
            select: {
              id: true,
              name: true,
              planKey: true,
              _count: { select: { members: true, apps: true } },
              apps: { orderBy: { createdAt: 'asc' }, take: 1, select: { slug: true } },
            },
          },
        },
      },
    },
  });

  const organizations: OrganizationChoice[] = disambiguate(
    (user?.memberships ?? []).map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      detail: describeOrganization({
        role: membership.role,
        planKey: membership.organization.planKey,
        memberCount: membership.organization._count.members,
        appCount: membership.organization._count.apps,
        sampleAppSlug: membership.organization.apps[0]?.slug ?? null,
      }),
    })),
  );

  return (
    <OAuthOrganizationPicker
      initialOrganizationId={user?.activeOrganizationId ?? null}
      organizations={organizations}
    />
  );
}
