import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { OAuthConsent } from './consent';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isRemoteMcpOAuthEnabled } from '@/lib/mcp/features';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OAuthConsentPage({ searchParams }: { searchParams: SearchParams }) {
  if (!isRemoteMcpOAuthEnabled()) notFound();
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const query = await searchParams;
  if (!session) {
    const serialized = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string') serialized.set(key, value);
      else value?.forEach((item) => serialized.append(key, item));
    }
    redirect(`/login?${serialized.toString()}`);
  }

  const clientId = typeof query.client_id === 'string' ? query.client_id : '';
  if (!clientId) notFound();
  const client = await auth.api.getOAuthClientPublic({
    headers: requestHeaders,
    query: { client_id: clientId },
  });
  if (!client) notFound();
  const scopes = (typeof query.scope === 'string' ? query.scope.split(' ') : []).filter(Boolean);
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      activeOrganization: {
        select: { id: true, name: true },
      },
      activeOrganizationId: true,
      memberships: { select: { organizationId: true } },
    },
  });
  const selectedOrganization =
    user?.activeOrganizationId &&
    user.memberships.some((membership) => membership.organizationId === user.activeOrganizationId)
      ? user.activeOrganization
      : null;
  if (!selectedOrganization) redirect('/oauth/select-organization');

  return (
    <OAuthConsent
      client={{
        name: client.client_name ?? 'An MCP client',
        uri: client.client_uri ?? null,
      }}
      organizationName={selectedOrganization.name}
      scopes={scopes}
    />
  );
}
