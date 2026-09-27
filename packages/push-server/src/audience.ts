import { z } from 'zod';

import { type Prisma, pushDb } from './db';

const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).min(1).max(100).optional();

/**
 * Who receives a campaign. Filters of different kinds are combined with AND;
 * values within one kind with OR. An empty audience means every device of the app.
 */
export const audienceSchema = z.object({
  platforms: list(z.enum(['ios', 'android'])),
  channels: list(z.string().trim().min(1).max(64)),
  runtimeVersions: list(z.string().trim().min(1).max(64)),
  topics: list(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)),
  userIds: list(z.string().trim().min(1).max(128)),
  deviceIds: list(z.string().uuid()),
});

export type Audience = z.infer<typeof audienceSchema>;

export function audienceWhere(appId: string, audience: Audience): Prisma.PushDeviceWhereInput {
  return {
    appId,
    ...(audience.platforms ? { platform: { in: audience.platforms } } : {}),
    ...(audience.channels ? { channel: { in: audience.channels } } : {}),
    ...(audience.runtimeVersions ? { runtimeVersion: { in: audience.runtimeVersions } } : {}),
    ...(audience.topics ? { topics: { hasSome: audience.topics } } : {}),
    ...(audience.userIds ? { externalUserId: { in: audience.userIds } } : {}),
    ...(audience.deviceIds ? { id: { in: audience.deviceIds } } : {}),
  };
}

export async function countAudience(
  appId: string,
  audience: Audience,
): Promise<{ total: number; ios: number; android: number }> {
  const rows = await pushDb().pushDevice.groupBy({
    by: ['platform'],
    where: audienceWhere(appId, audience),
    _count: { _all: true },
  });
  const ios = rows.find((row) => row.platform === 'ios')?._count._all ?? 0;
  const android = rows.find((row) => row.platform === 'android')?._count._all ?? 0;
  return { total: ios + android, ios, android };
}
