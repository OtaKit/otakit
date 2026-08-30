import { Prisma, type PrismaClient } from '@prisma/client';

import { db } from './db';
import { sendAutoRevertEmail } from './email';

export const AUTO_REVERT_REVERTED_BY = 'system:auto-revert';

const ALERT_CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

export type AutoRevertAlertPayload = {
  appId: string;
  channel: string | null;
  runtimeVersion: string | null;
  bundleVersion: string;
  rollbacks: number;
  attempts: number;
  measuredRatePercent: number;
  ratePercent: number;
  minSample: number;
  windowHours: number;
};

type AlertDatabase = Pick<PrismaClient, 'organizationMember' | 'release' | 'releaseMutation'>;
type AlertEmailSender = typeof sendAutoRevertEmail;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseAutoRevertAlertPayload(value: unknown): AutoRevertAlertPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.appId !== 'string' ||
    !isNullableString(payload.channel) ||
    !isNullableString(payload.runtimeVersion) ||
    typeof payload.bundleVersion !== 'string' ||
    !isFiniteNumber(payload.rollbacks) ||
    !isFiniteNumber(payload.attempts) ||
    !isFiniteNumber(payload.measuredRatePercent) ||
    !isFiniteNumber(payload.ratePercent) ||
    !isFiniteNumber(payload.minSample) ||
    !isFiniteNumber(payload.windowHours)
  ) {
    return null;
  }
  return payload as AutoRevertAlertPayload;
}

function revertedToVersion(result: Prisma.JsonValue | null): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const currentRelease = (result as Prisma.JsonObject).currentRelease;
  if (!currentRelease || typeof currentRelease !== 'object' || Array.isArray(currentRelease)) {
    return null;
  }
  const version = (currentRelease as Prisma.JsonObject).bundleVersion;
  return typeof version === 'string' ? version : null;
}

export async function sendAutoRevertAlerts(
  input: {
    releaseId: string;
    organizationId: string;
    appSlug: string;
    payload: AutoRevertAlertPayload;
    revertedToVersion: string | null;
    suppressed: boolean;
  },
  dependencies: { database?: AlertDatabase; sendEmail?: AlertEmailSender } = {},
): Promise<void> {
  const database = dependencies.database ?? db;
  const sendEmail = dependencies.sendEmail ?? sendAutoRevertEmail;
  const members = await database.organizationMember.findMany({
    where: {
      organizationId: input.organizationId,
      role: { in: ['owner', 'admin'] },
    },
    select: { user: { select: { email: true } } },
  });
  const recipients = Array.from(new Set(members.map((member) => member.user.email)));
  await Promise.all(
    recipients.map((email) =>
      sendEmail({
        to: email,
        appSlug: input.appSlug,
        channel: input.payload.channel,
        runtimeVersion: input.payload.runtimeVersion,
        bundleVersion: input.payload.bundleVersion,
        rollbacks: input.payload.rollbacks,
        attempts: input.payload.attempts,
        measuredRatePercent: input.payload.measuredRatePercent,
        thresholdRatePercent: input.payload.ratePercent,
        minSample: input.payload.minSample,
        revertedToVersion: input.revertedToVersion,
        suppressed: input.suppressed,
      }).catch((error) => {
        console.error('[AutoRevert] alert email failed', {
          appId: input.payload.appId,
          releaseId: input.releaseId,
          email,
          error,
        });
      }),
    ),
  );
}

export async function deliverPendingAutoRevertAlerts(
  options: { releaseIds?: string[]; limit?: number; now?: Date } = {},
  dependencies: { database?: AlertDatabase; sendEmail?: AlertEmailSender } = {},
): Promise<{ checked: number; sent: number; pending: number }> {
  const database = dependencies.database ?? db;
  const now = options.now ?? new Date();
  const staleClaim = new Date(now.getTime() - ALERT_CLAIM_TIMEOUT_MS);
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const releases = await database.release.findMany({
    where: {
      revertedBy: AUTO_REVERT_REVERTED_BY,
      autoRevertAlertPayload: { not: Prisma.DbNull },
      autoRevertAlertedAt: null,
      ...(options.releaseIds?.length ? { id: { in: options.releaseIds } } : {}),
      OR: [{ autoRevertAlertClaimedAt: null }, { autoRevertAlertClaimedAt: { lt: staleClaim } }],
    },
    orderBy: { revertedAt: 'asc' },
    take: limit,
    select: {
      id: true,
      autoRevertAlertPayload: true,
      app: { select: { organizationId: true, slug: true } },
    },
  });
  if (releases.length === 0) return { checked: 0, sent: 0, pending: 0 };

  const mutations = await database.releaseMutation.findMany({
    where: {
      operation: 'revert',
      status: 'published',
      releaseId: { in: releases.map((release) => release.id) },
    },
    orderBy: { createdAt: 'desc' },
    select: { releaseId: true, result: true },
  });
  const mutationByReleaseId = new Map<string, (typeof mutations)[number]>();
  for (const mutation of mutations) {
    if (mutation.releaseId && !mutationByReleaseId.has(mutation.releaseId)) {
      mutationByReleaseId.set(mutation.releaseId, mutation);
    }
  }

  let sent = 0;
  for (const release of releases) {
    const mutation = mutationByReleaseId.get(release.id);
    if (!mutation) continue;
    const payload = parseAutoRevertAlertPayload(release.autoRevertAlertPayload);
    if (!payload) {
      console.error('[AutoRevert] invalid persisted alert payload', { releaseId: release.id });
      continue;
    }

    const claimed = await database.release.updateMany({
      where: {
        id: release.id,
        autoRevertAlertedAt: null,
        OR: [{ autoRevertAlertClaimedAt: null }, { autoRevertAlertClaimedAt: { lt: staleClaim } }],
      },
      data: { autoRevertAlertClaimedAt: now },
    });
    if (claimed.count !== 1) continue;

    try {
      await sendAutoRevertAlerts(
        {
          releaseId: release.id,
          organizationId: release.app.organizationId,
          appSlug: release.app.slug,
          payload,
          revertedToVersion: revertedToVersion(mutation.result),
          suppressed: false,
        },
        dependencies,
      );
      await database.release.updateMany({
        where: {
          id: release.id,
          autoRevertAlertedAt: null,
          autoRevertAlertClaimedAt: now,
        },
        data: { autoRevertAlertedAt: now, autoRevertAlertClaimedAt: null },
      });
      sent += 1;
    } catch (error) {
      await database.release.updateMany({
        where: { id: release.id, autoRevertAlertedAt: null, autoRevertAlertClaimedAt: now },
        data: { autoRevertAlertClaimedAt: null },
      });
      throw error;
    }
  }

  return { checked: releases.length, sent, pending: releases.length - sent };
}
