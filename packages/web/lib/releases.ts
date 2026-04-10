import type { PrismaClient, Release } from '@prisma/client';

export async function createRelease(
  db: PrismaClient,
  input: {
    appId: string;
    bundleId: string;
    previousBundleId?: string | null;
    channel: string | null;
    promotedBy?: string;
  },
): Promise<Release> {
  return db.release.create({
    data: {
      appId: input.appId,
      bundleId: input.bundleId,
      previousBundleId: input.previousBundleId ?? null,
      channel: input.channel,
      promotedBy: input.promotedBy,
    },
  });
}
