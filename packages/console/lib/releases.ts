import type { Prisma, PrismaClient, Release } from '@prisma/client';

import { recordAuditLog, type AuditAction, type AuditActor } from './audit-log';
import { db } from './db';
import { syncManifestFileForLane } from './manifest-files';

export async function createRelease(
  db: PrismaClient,
  input: {
    appId: string;
    bundleId: string;
    previousBundleId?: string | null;
    channel: string | null;
    forceImmediate?: boolean;
    autoRevert?: boolean;
    autoRevertRatePercent?: number;
    autoRevertMinSample?: number;
    promotedBy?: string;
  },
): Promise<Release> {
  return db.release.create({
    data: {
      appId: input.appId,
      bundleId: input.bundleId,
      previousBundleId: input.previousBundleId ?? null,
      channel: input.channel,
      forceImmediate: input.forceImmediate ?? false,
      autoRevert: input.autoRevert ?? false,
      autoRevertRatePercent: input.autoRevertRatePercent ?? 20,
      autoRevertMinSample: input.autoRevertMinSample ?? 50,
      promotedBy: input.promotedBy,
    },
  });
}

const releaseWithBundlesInclude = {
  bundle: { select: { version: true, runtimeVersion: true } },
  previousBundle: { select: { version: true } },
} satisfies Prisma.ReleaseInclude;

export type ReleaseWithBundles = Prisma.ReleaseGetPayload<{
  include: typeof releaseWithBundlesInclude;
}>;

export type RevertOutcome =
  | {
      ok: true;
      targetRelease: ReleaseWithBundles;
      nextCurrentRelease: ReleaseWithBundles | null;
      revertedAt: Date;
      revertedBy: string;
    }
  | { ok: false; reason: 'not_found' | 'already_reverted' | 'not_current' };

/**
 * Revert the current release of its (channel, runtimeVersion) lane: mark it
 * reverted, resolve the release that becomes current, re-bake the lane
 * manifest, and write an audit log entry. Shared by the manual revert route
 * and the auto-revert cron.
 *
 * When `forceImmediate` is provided, it is applied to the release that becomes
 * current (so a revert can itself be forced onto devices).
 */
export async function revertCurrentRelease(input: {
  appId: string;
  releaseId: string;
  revertedBy: string;
  actor: AuditActor;
  organizationId: string;
  forceImmediate?: boolean;
  auditAction?: AuditAction;
  auditMetadata?: Record<string, unknown>;
}): Promise<RevertOutcome> {
  const targetRelease = await db.release.findFirst({
    where: { id: input.releaseId, appId: input.appId },
    include: releaseWithBundlesInclude,
  });

  if (!targetRelease) {
    return { ok: false, reason: 'not_found' };
  }

  if (targetRelease.revertedAt !== null) {
    return { ok: false, reason: 'already_reverted' };
  }

  const laneWhere = {
    appId: input.appId,
    channel: targetRelease.channel,
    revertedAt: null,
    bundle: {
      is: {
        runtimeVersion: targetRelease.bundle.runtimeVersion,
      },
    },
  } satisfies Prisma.ReleaseWhereInput;

  const currentRelease = await db.release.findFirst({
    where: laneWhere,
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });

  if (!currentRelease || currentRelease.id !== targetRelease.id) {
    return { ok: false, reason: 'not_current' };
  }

  const revertedAt = new Date();

  // Guarded write: a concurrent revert (human racing the cron, overlapping
  // cron ticks) loses here and must not re-sync the manifest or double-audit.
  const { count } = await db.release.updateMany({
    where: { id: targetRelease.id, revertedAt: null },
    data: { revertedAt, revertedBy: input.revertedBy },
  });
  if (count === 0) {
    return { ok: false, reason: 'already_reverted' };
  }

  let nextCurrentRelease = await db.release.findFirst({
    where: laneWhere,
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    include: releaseWithBundlesInclude,
  });

  if (input.forceImmediate !== undefined && nextCurrentRelease) {
    nextCurrentRelease = await db.release.update({
      where: { id: nextCurrentRelease.id },
      data: { forceImmediate: input.forceImmediate },
      include: releaseWithBundlesInclude,
    });
  }

  await syncManifestFileForLane(
    input.appId,
    targetRelease.channel,
    targetRelease.bundle.runtimeVersion,
  );

  await recordAuditLog({
    organizationId: input.organizationId,
    actor: input.actor,
    action: input.auditAction ?? 'release.reverted',
    targetType: 'release',
    targetId: targetRelease.id,
    metadata: {
      appId: input.appId,
      channel: targetRelease.channel,
      bundleVersion: targetRelease.bundle.version,
      runtimeVersion: targetRelease.bundle.runtimeVersion,
      ...input.auditMetadata,
    },
  });

  return {
    ok: true,
    targetRelease,
    nextCurrentRelease,
    revertedAt,
    revertedBy: input.revertedBy,
  };
}
