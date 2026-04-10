import { headers } from 'next/headers';
import { auth } from './auth';
import { db } from './db';

export type SessionContext = {
  userId: string;
  email: string;
  organizationId: string;
  role: 'owner' | 'admin' | 'member';
};

/**
 * Get the current session and resolve active organization + membership role.
 * Returns null if not authenticated or no valid organization membership.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const user = session.user as { id: string; email: string };
  const userRow = await db.user.findUnique({
    where: { id: user.id },
    select: { activeOrganizationId: true },
  });
  if (!userRow?.activeOrganizationId) return null;

  const membership = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: userRow.activeOrganizationId, userId: user.id },
    },
    select: { role: true },
  });
  if (!membership) return null;

  return {
    userId: user.id,
    email: user.email,
    organizationId: userRow.activeOrganizationId,
    role: membership.role,
  };
}
