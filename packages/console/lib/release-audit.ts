import type { OrganizationAccess } from './organization-access';
import { db } from './db';

const MAX_PROMOTED_BY_LENGTH = 120;

function trimPromotedBy(value: string): string {
  return value.slice(0, MAX_PROMOTED_BY_LENGTH);
}

export async function resolveReleaseActor(access: OrganizationAccess): Promise<string> {
  try {
    if (access.actorType === 'user') {
      const user = await db.user.findUnique({
        where: { id: access.actorId },
        select: { email: true },
      });

      if (user?.email) {
        return trimPromotedBy(user.email);
      }

      return trimPromotedBy(`user:${access.actorId.slice(0, 8)}`);
    }

    const apiKey = await db.organizationApiKey.findUnique({
      where: { id: access.actorId },
      select: { name: true, keyPrefix: true },
    });

    if (apiKey?.name) {
      return trimPromotedBy(`api-key:${apiKey.name}`);
    }

    if (apiKey?.keyPrefix) {
      return trimPromotedBy(`api-key:${apiKey.keyPrefix}`);
    }

    return 'api-key:unknown';
  } catch {
    return access.actorType === 'user' ? 'user:unknown' : 'api-key:unknown';
  }
}
