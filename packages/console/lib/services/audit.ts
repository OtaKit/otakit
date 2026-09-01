import { db } from '@/lib/db';
import type { OrganizationAccess } from '@/lib/organization-access';

import { OtaKitServiceError } from './errors';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function listAuditLog(input: {
  access: OrganizationAccess;
  cursor?: string;
  limit?: number;
}) {
  if (
    input.access.actorType !== 'user' ||
    (input.access.role !== 'owner' && input.access.role !== 'admin')
  ) {
    throw new OtaKitServiceError(
      'INSUFFICIENT_ROLE',
      'Only organization owners and admins can read the audit log',
      403,
    );
  }

  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const rows = await db.auditLog.findMany({
    where: { organizationId: input.access.organizationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;
  return {
    entries: entries.map((entry) => ({
      id: entry.id,
      actorType: entry.actorType,
      actorLabel: entry.actorLabel,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata,
      createdAt: entry.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? (entries.at(-1)?.id ?? null) : null,
  };
}
