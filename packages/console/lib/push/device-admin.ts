import { db } from '@/lib/db';
import { OtaKitServiceError } from '@/lib/services/errors';

export type DeviceSummary = {
  id: string;
  platform: 'ios' | 'android';
  environment: 'production' | 'sandbox';
  tokenPreview: string;
  externalUserId: string | null;
  topics: string[];
  channel: string | null;
  bundleVersion: string | null;
  appVersion: string | null;
  lastSeenAt: string;
  createdAt: string;
};

export async function getDeviceOverview(appId: string) {
  const [byPlatform, byChannel, topicRows] = await Promise.all([
    db.pushDevice.groupBy({
      by: ['platform', 'environment'],
      where: { appId },
      _count: { _all: true },
    }),
    db.pushDevice.groupBy({
      by: ['channel'],
      where: { appId },
      _count: { _all: true },
      orderBy: { _count: { channel: 'desc' } },
      take: 20,
    }),
    db.$queryRaw<Array<{ topic: string; count: bigint }>>`
      SELECT topic, count(*) AS count
      FROM "PushDevice", unnest(topics) AS topic
      WHERE "appId" = ${appId}
      GROUP BY topic ORDER BY count DESC LIMIT 50`,
  ]);
  const count = (platform: string, environment?: string) =>
    byPlatform
      .filter(
        (row) => row.platform === platform && (!environment || row.environment === environment),
      )
      .reduce((sum, row) => sum + row._count._all, 0);
  return {
    total: count('ios') + count('android'),
    ios: count('ios'),
    android: count('android'),
    iosSandbox: count('ios', 'sandbox'),
    channels: byChannel.map((row) => ({ channel: row.channel, count: row._count._all })),
    topics: topicRows.map((row) => ({ topic: row.topic, count: Number(row.count) })),
  };
}

export async function listDevices(input: {
  appId: string;
  search?: string | null;
  limit?: number;
}): Promise<DeviceSummary[]> {
  const search = input.search?.trim();
  const rows = await db.pushDevice.findMany({
    where: {
      appId: input.appId,
      ...(search
        ? {
            OR: [
              { externalUserId: search },
              { token: { startsWith: search.toLowerCase() } },
              { token: { startsWith: search } },
            ],
          }
        : {}),
    },
    orderBy: { lastSeenAt: 'desc' },
    take: Math.min(Math.max(input.limit ?? 50, 1), 200),
  });
  return rows.map((row) => ({
    id: row.id,
    platform: row.platform,
    environment: row.environment,
    tokenPreview: `${row.token.slice(0, 10)}…`,
    externalUserId: row.externalUserId,
    topics: row.topics,
    channel: row.channel,
    bundleVersion: row.bundleVersion,
    appVersion: row.appVersion,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function deleteDevice(appId: string, deviceId: string): Promise<void> {
  const deleted = await db.pushDevice.deleteMany({ where: { id: deviceId, appId } });
  if (deleted.count === 0) throw new OtaKitServiceError('INVALID_INPUT', 'Device not found', 404);
}

export async function getPushUsage(organizationId: string) {
  const { getPushLimits, pushPeriodStart } = await import('./limits');
  const organization = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { planKey: true, usagePeriodStart: true },
  });
  const periodStart = pushPeriodStart(organization.usagePeriodStart);
  const [usage, devices] = await Promise.all([
    db.pushUsage.findUnique({
      where: { organizationId_periodStart: { organizationId, periodStart } },
      select: { sends: true },
    }),
    db.pushDevice.count({ where: { app: { organizationId } } }),
  ]);
  const limits = getPushLimits(organization.planKey);
  return {
    periodStart: periodStart.toISOString(),
    sends: usage?.sends ?? 0,
    sendsLimit: limits.sendsPerMonth,
    devices,
    devicesLimit: limits.devices,
  };
}
