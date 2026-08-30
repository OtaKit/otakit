import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { accessActor, recordAuditLog } from '@/lib/audit-log';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isRemoteMcpOAuthEnabled, remoteMcpResourceUrl } from '@/lib/mcp/features';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ consentId: string }> },
) {
  if (!isRemoteMcpOAuthEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { consentId } = await params;
  const consent = await db.oauthConsent.findFirst({
    where: {
      id: consentId,
      userId: session.user.id,
      resources: { has: remoteMcpResourceUrl() },
    },
    select: { id: true, clientId: true, referenceId: true },
  });
  if (!consent) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

  const revokedAt = new Date();
  await db.$transaction([
    db.oauthAccessToken.updateMany({
      where: {
        userId: session.user.id,
        clientId: consent.clientId,
        referenceId: consent.referenceId,
        revoked: null,
      },
      data: { revoked: revokedAt },
    }),
    db.oauthRefreshToken.updateMany({
      where: {
        userId: session.user.id,
        clientId: consent.clientId,
        referenceId: consent.referenceId,
        revoked: null,
      },
      data: { revoked: revokedAt },
    }),
    db.oauthConsent.delete({ where: { id: consent.id } }),
  ]);

  if (consent.referenceId) {
    await recordAuditLog({
      organizationId: consent.referenceId,
      actor: await accessActor({
        organizationId: consent.referenceId,
        actorType: 'user',
        actorId: session.user.id,
      }),
      action: 'oauth.connection_revoked',
      targetType: 'oauth_client',
      targetId: consent.clientId,
    });
  }

  return NextResponse.json({ revoked: true, id: consent.id });
}
