import type { PrismaClient } from '@prisma/client';

import { db } from '@/lib/db';
import type { OrganizationAccess } from '@/lib/organization-access';

import { OTAKIT_OAUTH_SCOPES, isOtaKitOAuthScope, remoteMcpResourceUrl } from './features';

export type OAuthTokenClaims = Record<string, unknown>;

export type RemoteMcpConnection = {
  access: OrganizationAccess;
  scopes: ReadonlySet<string>;
  credentialType: 'organization_key' | 'oauth';
  clientId: string | null;
  clientName: string | null;
  oauthClaims?: OAuthTokenClaims;
};

export class RemoteMcpAuthError extends Error {
  readonly code: 'INVALID_TOKEN' | 'CONSENT_REVOKED' | 'MEMBERSHIP_REVOKED';

  constructor(code: RemoteMcpAuthError['code'], message: string) {
    super(message);
    this.name = 'RemoteMcpAuthError';
    this.code = code;
  }
}

function requiredStringClaim(claims: OAuthTokenClaims, name: string): string {
  const value = claims[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RemoteMcpAuthError('INVALID_TOKEN', `OAuth token is missing ${name}`);
  }
  return value;
}

export function scopesFromClaims(claims: OAuthTokenClaims): ReadonlySet<string> {
  const raw = claims.scope;
  const values = Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === 'string')
    : typeof raw === 'string'
      ? raw.split(/\s+/)
      : [];
  return new Set(values.map((value) => value.trim()).filter(Boolean));
}

export function organizationKeyConnection(input: {
  organizationId: string;
  keyId: string;
}): RemoteMcpConnection {
  return {
    access: {
      organizationId: input.organizationId,
      actorType: 'key',
      actorId: input.keyId,
    },
    scopes: new Set(OTAKIT_OAUTH_SCOPES),
    credentialType: 'organization_key',
    clientId: null,
    clientName: null,
  };
}

export async function resolveOAuthConnection(
  claims: OAuthTokenClaims,
  database: PrismaClient = db,
): Promise<RemoteMcpConnection> {
  const organizationId = requiredStringClaim(claims, 'otakit_organization_id');
  const userId = requiredStringClaim(claims, 'otakit_user_id');
  const clientId = requiredStringClaim(claims, 'client_id');
  const subject = typeof claims.sub === 'string' ? claims.sub : null;
  if (subject && subject !== userId) {
    throw new RemoteMcpAuthError('INVALID_TOKEN', 'OAuth token subject does not match its user');
  }

  const scopes = scopesFromClaims(claims);
  const unsupportedScope = Array.from(scopes).find(
    (scope) => scope !== 'offline_access' && !isOtaKitOAuthScope(scope),
  );
  if (unsupportedScope) {
    throw new RemoteMcpAuthError('INVALID_TOKEN', 'OAuth token contains an unsupported scope');
  }

  const [membership, consent] = await Promise.all([
    database.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    }),
    database.oauthConsent.findFirst({
      where: { clientId, userId, referenceId: organizationId },
      orderBy: { updatedAt: 'desc' },
      select: {
        scopes: true,
        resources: true,
        client: { select: { name: true, disabled: true } },
      },
    }),
  ]);

  if (!membership) {
    throw new RemoteMcpAuthError(
      'MEMBERSHIP_REVOKED',
      'The user is no longer a member of this organization',
    );
  }
  if (!consent || consent.client.disabled === true) {
    throw new RemoteMcpAuthError('CONSENT_REVOKED', 'This OtaKit MCP connection has been revoked');
  }
  if (!consent.resources.includes(remoteMcpResourceUrl())) {
    throw new RemoteMcpAuthError('INVALID_TOKEN', 'OAuth consent is not bound to this MCP server');
  }
  if (Array.from(scopes).some((scope) => !consent.scopes.includes(scope))) {
    throw new RemoteMcpAuthError('CONSENT_REVOKED', 'OAuth consent no longer grants this scope');
  }

  return {
    access: {
      organizationId,
      actorType: 'user',
      actorId: userId,
      role: membership.role,
    },
    scopes,
    credentialType: 'oauth',
    clientId,
    clientName: consent.client.name,
    oauthClaims: claims,
  };
}
