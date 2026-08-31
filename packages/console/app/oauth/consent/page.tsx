import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { OAuthConsent } from './consent';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isRemoteMcpOAuthEnabled } from '@/lib/mcp/features';
import {
  normalizeOAuthOrganizationId,
  OTAKIT_OAUTH_ORGANIZATION_QUERY,
} from '@/lib/mcp/oauth-organization-shared';
import { selectedOAuthOrganizationId } from '@/lib/mcp/oauth-organization';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function oauthPagePath(path: string, query: Record<string, string | string[] | undefined>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === 'string') params.set(name, value);
    else value?.forEach((item) => params.append(name, item));
  }
  params.delete(OTAKIT_OAUTH_ORGANIZATION_QUERY);
  const serialized = params.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export default async function OAuthConsentPage({ searchParams }: { searchParams: SearchParams }) {
  if (!isRemoteMcpOAuthEnabled()) notFound();
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const query = await searchParams;
  if (!session) {
    redirect(oauthPagePath('/login', query));
  }

  const clientId = typeof query.client_id === 'string' ? query.client_id : '';
  if (!clientId) notFound();
  const client = await auth.api.getOAuthClientPublic({
    headers: requestHeaders,
    query: { client_id: clientId },
  });
  if (!client) notFound();
  const scopes = (typeof query.scope === 'string' ? query.scope.split(' ') : []).filter(Boolean);
  const organizationId =
    normalizeOAuthOrganizationId(
      typeof query[OTAKIT_OAUTH_ORGANIZATION_QUERY] === 'string'
        ? query[OTAKIT_OAUTH_ORGANIZATION_QUERY]
        : undefined,
    ) ?? (await selectedOAuthOrganizationId(session.user.id, requestHeaders));
  const selectedMembership = organizationId
    ? await db.organizationMember.findUnique({
        where: {
          organizationId_userId: { organizationId, userId: session.user.id },
        },
        select: {
          organization: { select: { id: true, name: true } },
        },
      })
    : null;
  if (!selectedMembership) {
    redirect(oauthPagePath('/oauth/select-organization', query));
  }
  const selectedOrganization = selectedMembership.organization;
  const duplicateNameCount = await db.organizationMember.count({
    where: {
      userId: session.user.id,
      organization: { name: selectedOrganization.name },
    },
  });
  const organizationDisplayName =
    duplicateNameCount > 1
      ? `${selectedOrganization.name} · ${selectedOrganization.id.slice(0, 8)}`
      : selectedOrganization.name;

  return (
    <OAuthConsent
      client={{
        name: client.client_name ?? 'An MCP client',
        uri: client.client_uri ?? null,
      }}
      organizationId={selectedOrganization.id}
      organizationName={organizationDisplayName}
      scopes={scopes}
    />
  );
}
