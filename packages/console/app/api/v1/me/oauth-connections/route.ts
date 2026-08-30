import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isRemoteMcpOAuthEnabled, remoteMcpResourceUrl } from '@/lib/mcp/features';

export const runtime = 'nodejs';

export async function GET() {
  if (!isRemoteMcpOAuthEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const consents = await db.oAuthConsent.findMany({
    where: {
      userId: session.user.id,
      resources: { has: remoteMcpResourceUrl() },
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      client: { select: { clientId: true, name: true, uri: true } },
    },
  });
  const organizationIds = Array.from(
    new Set(
      consents.map((consent) => consent.referenceId).filter((id): id is string => Boolean(id)),
    ),
  );
  const organizations = await db.organization.findMany({
    where: { id: { in: organizationIds } },
    select: { id: true, name: true },
  });
  const organizationNames = new Map(
    organizations.map((organization) => [organization.id, organization.name]),
  );

  return NextResponse.json({
    connections: consents.map((consent) => ({
      id: consent.id,
      clientId: consent.client.clientId,
      clientName: consent.client.name ?? 'MCP client',
      clientUri: consent.client.uri,
      organization: consent.referenceId
        ? {
            id: consent.referenceId,
            name: organizationNames.get(consent.referenceId) ?? 'Former organization',
          }
        : null,
      scopes: consent.scopes,
      createdAt: consent.createdAt.toISOString(),
      updatedAt: consent.updatedAt.toISOString(),
    })),
  });
}
