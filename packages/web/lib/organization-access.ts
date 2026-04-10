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
  | { success: false; error: string; status: number };

async function resolveSessionAccess(
  request: NextRequest,
  appId?: string,
): Promise<OrganizationAccessResult> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return { success: false, error: 'Not authenticated', status: 401 };
  }

  const user = session.user as { id: string };
  const userRow = await db.user.findUnique({
    where: { id: user.id },
    select: { activeOrganizationId: true },
  });
  if (!userRow?.activeOrganizationId) {
    return { success: false, error: 'No active organization', status: 403 };
  }

  const membership = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: userRow.activeOrganizationId, userId: user.id },
    },
    select: { role: true },
  });

  if (!membership) {
    return { success: false, error: 'Not a member of active organization', status: 403 };
  }

  if (appId) {
    const owned = await isAppOwnedByOrganization(appId, userRow.activeOrganizationId);
    if (!owned) {
      return { success: false, error: 'App not found', status: 404 };
    }
  }

  return {
    success: true,
    access: {
      organizationId: userRow.activeOrganizationId,
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
    const sessionAccess = await resolveSessionAccess(request, appId);
    if (sessionAccess.success) {
      return sessionAccess;
    }
    return sessionAccess;
  }

  // 2. Session auth (cookie or bearer-converted session token)
  return resolveSessionAccess(request, appId);
}
