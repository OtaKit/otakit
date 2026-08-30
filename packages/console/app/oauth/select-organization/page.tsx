import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { OAuthOrganizationPicker } from './picker';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isRemoteMcpOAuthEnabled } from '@/lib/mcp/features';

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
          organization: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!user || user.memberships.length === 0) {
    throw new Error('No OtaKit organization is available for this account');
  }

  return (
    <OAuthOrganizationPicker
      initialOrganizationId={user.activeOrganizationId}
      organizations={user.memberships.map((membership) => ({
        id: membership.organization.id,
        name: membership.organization.name,
        role: membership.role,
      }))}
    />
  );
}
