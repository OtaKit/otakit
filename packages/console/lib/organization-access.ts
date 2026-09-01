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
  bearerRequest = false,
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
  if (!organizationId && appId && bearerRequest) {
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
  if (!organizationId && bearerRequest) {
    const memberships = await db.organizationMember.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      take: 2,
      select: { organizationId: true },
    });
    if (memberships.length > 1) {
      return {
        success: false,
        error: 'Choose an organization for this command.',
        status: 409,
        code: 'ORGANIZATION_SELECTION_REQUIRED',
        nextStep:
          'Run `otakit organization select` and retry, or set OTAKIT_ORGANIZATION_ID for automation.',
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
    return {
      success: false,
      error: bearerRequest ? 'No organization membership' : 'No active organization',
      status: 403,
    };
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
    const sessionAccess = await resolveSessionAccess(request, appId, true);
    if (sessionAccess.success) {
      return sessionAccess;
    }
    return sessionAccess;
  }

  // 2. Session auth (cookie or bearer-converted session token)
  return resolveSessionAccess(request, appId, false);
}
