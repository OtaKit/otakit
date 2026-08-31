import { NextRequest } from 'next/server';

import { auth } from './auth';
import { verifySecretAuth, isAppOwnedByOrganization } from './api-auth';
import { db } from './db';

export type OrganizationAccess = {
  organizationId: string;
  actorType: 'key' | 'user';
  actorId: string;
  role?: 'owner' | 'admin' | 'member';
};

export type OrganizationAccessResult =
  | { success: true; access: OrganizationAccess }
  | { success: false; error: string; status: number; code?: string; nextStep?: string };

type ResolveOrganizationAccessOptions = {
  inferOrganizationFromAppId?: boolean;
  requireExplicitOrganizationForMultipleMemberships?: boolean;
};

export const ORGANIZATION_ID_HEADER = 'x-otakit-organization-id';

function requestedOrganizationId(
  request: NextRequest,
): { present: false } | { present: true; id: string } | { present: true; error: string } {
  if (!request.headers.has(ORGANIZATION_ID_HEADER)) return { present: false };
  const raw = request.headers.get(ORGANIZATION_ID_HEADER)?.trim() ?? '';
  if (!raw || raw.length > 128) {
    return { present: true, error: 'Invalid organization ID header' };
  }
  return { present: true, id: raw };
}

async function resolveSessionAccess(
  request: NextRequest,
  appId?: string,
  options: ResolveOrganizationAccessOptions = {},
): Promise<OrganizationAccessResult> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return { success: false, error: 'Not authenticated', status: 401 };
  }

  const user = session.user as { id: string };
  const requestedOrganization = requestedOrganizationId(request);
  if ('error' in requestedOrganization) {
    return { success: false, error: requestedOrganization.error, status: 400 };
  }
  const explicitOrganizationId = requestedOrganization.present ? requestedOrganization.id : null;
  let organizationId = explicitOrganizationId;
  let organizationInferredFromApp = false;
  if (!organizationId && appId && options.inferOrganizationFromAppId) {
    const app = await db.app.findFirst({
      where: {
        id: appId,
        organization: { members: { some: { userId: user.id } } },
      },
      select: { organizationId: true },
    });
    if (!app) {
      return { success: false, error: 'App not found', status: 404 };
    }
    organizationId = app.organizationId;
    organizationInferredFromApp = true;
  }
  if (!organizationId && options.requireExplicitOrganizationForMultipleMemberships) {
    const memberships = await db.organizationMember.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      take: 11,
      select: {
        organizationId: true,
        organization: { select: { name: true } },
      },
    });
    if (memberships.length > 1) {
      const choices = memberships
        .slice(0, 10)
        .map(
          (membership) =>
            `- ${JSON.stringify(membership.organization.name)} (${membership.organizationId})`,
        )
        .join('\n');
      const suffix = memberships.length > 10 ? '\n- …' : '';
      return {
        success: false,
        error: `This account belongs to multiple organizations and the project has no configured OtaKit app.\nAvailable organizations:\n${choices}${suffix}\nRun \`otakit whoami\` if needed, then restart with \`otakit mcp --organization-id <id>\`.`,
        status: 409,
        code: 'ORGANIZATION_SELECTION_REQUIRED',
        nextStep:
          'Choose the intended organization shown above and pass its ID with --organization-id.',
      };
    }
    organizationId = memberships[0]?.organizationId ?? null;
  }
  if (!organizationId) {
    const userRow = await db.user.findUnique({
      where: { id: user.id },
      select: { activeOrganizationId: true },
    });
    organizationId = userRow?.activeOrganizationId ?? null;
  }
  if (!organizationId) {
    return { success: false, error: 'No active organization', status: 403 };
  }

  const membership = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId, userId: user.id },
    },
    select: { role: true },
  });

  if (!membership) {
    if (explicitOrganizationId) {
      return { success: false, error: 'Organization not found', status: 404 };
    }
    if (organizationInferredFromApp) {
      return { success: false, error: 'App not found', status: 404 };
    }
    return { success: false, error: 'Not a member of active organization', status: 403 };
  }

  if (appId && !organizationInferredFromApp) {
    const owned = await isAppOwnedByOrganization(appId, organizationId);
    if (!owned) {
      return { success: false, error: 'App not found', status: 404 };
    }
  }

  return {
    success: true,
    access: {
      organizationId,
      actorType: 'user',
      actorId: user.id,
      role: membership.role,
    },
  };
}

/**
 * Resolve organization access from either API key (Bearer token) or session cookie.
 * Checks API key first (CLI/automation), then falls back to session (dashboard).
 * If appId is provided, also validates that the app belongs to the resolved organization.
 */
export async function resolveOrganizationAccess(
  request: NextRequest,
  appId?: string,
  options: ResolveOrganizationAccessOptions = {},
): Promise<OrganizationAccessResult> {
  // 1. Try API key auth (Bearer header) first for CLI/CI automation
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const keyResult = await verifySecretAuth(authHeader);
    if (keyResult.success) {
      const requestedOrganization = requestedOrganizationId(request);
      if ('error' in requestedOrganization) {
        return { success: false, error: requestedOrganization.error, status: 400 };
      }
      const explicitOrganizationId = requestedOrganization.present
        ? requestedOrganization.id
        : null;
      if (explicitOrganizationId && explicitOrganizationId !== keyResult.organizationId) {
        return { success: false, error: 'Organization not found', status: 404 };
      }
      if (appId) {
        const owned = await isAppOwnedByOrganization(appId, keyResult.organizationId);
        if (!owned) {
          return { success: false, error: 'App not found', status: 404 };
        }
      }
      return {
        success: true,
        access: {
          organizationId: keyResult.organizationId,
          actorType: 'key',
          actorId: keyResult.keyId,
        },
      };
    }
    // If it's not a organization API key, try user bearer token auth via Better Auth.
    const sessionAccess = await resolveSessionAccess(request, appId, options);
    if (sessionAccess.success) {
      return sessionAccess;
    }
    return sessionAccess;
  }

  // 2. Session auth (cookie or bearer-converted session token)
  return resolveSessionAccess(request, appId, options);
}
