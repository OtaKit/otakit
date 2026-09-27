import { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

import { sendApnsBatch, type ApnsCredential, type ApnsResult } from './apns';
import { loadApnsCredential, loadFcmCredential } from './credentials';
import { sendFcmBatch, type FcmCredential } from './fcm';
import { pushPeriodStart } from './limits';
import {
  buildApnsPayload,
  buildFcmMessage,
  DEFAULT_TTL_SECONDS,
  type PushPayload,
} from './payload';

/** Attempts per device before a temporary failure counts as failed. */
export const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_SECONDS = [60, 300, 1800];
const STUCK_AFTER_MINUTES = 5;

type ClaimedBatch = { id: string; campaignId: string; deviceIds: string[]; attempts: number };

type DeviceRow = {
  id: string;
  token: string;
  provider: 'apns' | 'fcm';
  environment: 'production' | 'sandbox';
};

export type BatchOutcome = {
  accepted: number;
  failed: number;
  invalidDeviceIds: string[];
  retryDeviceIds: string[];
  retryAfterSeconds: number;
  sandboxDeviceIds: string[];
  errors: Record<string, number>;
  authFailure: string | null;
};

type Senders = {
  apns: typeof sendApnsBatch;
  fcm: typeof sendFcmBatch;
};

export async function claimBatches(limit: number): Promise<ClaimedBatch[]> {
  await db.$executeRaw`
    UPDATE "PushSendBatch"
    SET status = 'pending', "claimedAt" = NULL
    WHERE status = 'sending'
      AND "claimedAt" < now() - (${STUCK_AFTER_MINUTES} * interval '1 minute')`;
  return db.$queryRaw<ClaimedBatch[]>`
    UPDATE "PushSendBatch"
    SET status = 'sending', "claimedAt" = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "PushSendBatch"
      WHERE status = 'pending' AND "nextAttemptAt" <= now()
      ORDER BY "nextAttemptAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "campaignId", "deviceIds", attempts`;
}

function emptyOutcome(): BatchOutcome {
  return {
    accepted: 0,
    failed: 0,
    invalidDeviceIds: [],
    retryDeviceIds: [],
    retryAfterSeconds: 0,
    sandboxDeviceIds: [],
    errors: {},
    authFailure: null,
  };
}

function countError(outcome: BatchOutcome, key: string, amount = 1): void {
  outcome.errors[key] = (outcome.errors[key] ?? 0) + amount;
}

/**
 * Sends one batch and returns what happened to each device. Pure with respect to
 * the database, so it is testable with fake senders.
 */
export async function sendToDevices(input: {
  devices: DeviceRow[];
  payload: PushPayload;
  campaignId: string;
  apns: ApnsCredential | null;
  fcm: FcmCredential | null;
  senders?: Senders;
  now?: Date;
}): Promise<BatchOutcome> {
  const senders = input.senders ?? { apns: sendApnsBatch, fcm: sendFcmBatch };
  const outcome = emptyOutcome();
  const ttl = input.payload.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expirationUnix = Math.floor((input.now ?? new Date()).getTime() / 1000) + ttl;

  const apnsDevices = input.devices.filter((device) => device.provider === 'apns');
  const fcmDevices = input.devices.filter((device) => device.provider === 'fcm');

  const record = (
    provider: 'apns' | 'fcm',
    result: {
      deviceId: string;
      kind: string;
      reason?: string;
      status: number;
      retryAfterSeconds?: number;
    },
  ) => {
    switch (result.kind) {
      case 'ok':
        outcome.accepted += 1;
        break;
      case 'invalid':
        outcome.invalidDeviceIds.push(result.deviceId);
        countError(outcome, `${provider}:${result.reason ?? 'invalid'}`);
        break;
      case 'retry':
        outcome.retryDeviceIds.push(result.deviceId);
        outcome.retryAfterSeconds = Math.max(
          outcome.retryAfterSeconds,
          result.retryAfterSeconds ?? 0,
        );
        countError(outcome, `${provider}:${result.reason ?? 'retry'}`);
        break;
      case 'auth':
        outcome.failed += 1;
        outcome.authFailure ??=
          result.reason === 'TopicDisallowed' || result.reason === 'BadTopic'
            ? `Apple does not allow this key to send to the bundle ID (${result.reason}). Register the bundle ID as an App ID with Push Notifications in the same Apple team as the key.`
            : `${provider === 'apns' ? 'Apple' : 'Google'} rejected the credentials (${result.reason ?? result.status}).`;
        countError(outcome, `${provider}:${result.reason ?? 'auth'}`);
        break;
      default:
        outcome.failed += 1;
        countError(outcome, `${provider}:${result.reason ?? 'rejected'}`);
    }
  };

  if (apnsDevices.length > 0) {
    if (!input.apns) {
      outcome.failed += apnsDevices.length;
      countError(outcome, 'apns:not_configured', apnsDevices.length);
    } else {
      const apnsPayload = buildApnsPayload(input.payload);
      const send = (environment: 'production' | 'sandbox', devices: DeviceRow[]) =>
        senders.apns({
          credential: input.apns as ApnsCredential,
          environment,
          items: devices.map((device) => ({ deviceId: device.id, token: device.token })),
          payload: apnsPayload,
          expirationUnix,
          collapseId: input.campaignId,
        });

      const production = apnsDevices.filter((device) => device.environment === 'production');
      const sandbox = apnsDevices.filter((device) => device.environment === 'sandbox');
      const [productionResults, sandboxResults] = await Promise.all([
        production.length ? send('production', production) : Promise.resolve([]),
        sandbox.length ? send('sandbox', sandbox) : Promise.resolve([]),
      ]);

      // A development build's token fails on production with BadDeviceToken.
      // Try those once on sandbox before giving up on them.
      const badOnProduction = productionResults.filter(
        (result) => result.kind === 'invalid' && result.reason === 'BadDeviceToken',
      );
      let fallbackResults: ApnsResult[] = [];
      if (badOnProduction.length > 0) {
        const ids = new Set(badOnProduction.map((result) => result.deviceId));
        fallbackResults = await send(
          'sandbox',
          production.filter((device) => ids.has(device.id)),
        );
      }
      const fallbackById = new Map(fallbackResults.map((result) => [result.deviceId, result]));

      for (const result of productionResults) {
        const fallback = fallbackById.get(result.deviceId);
        if (fallback) {
          // ok: a development build's token. invalid on both: a dead token.
          // Anything else (e.g. TopicDisallowed, throttling) is the real reason,
          // so report it instead of deleting a device that may be fine.
          if (fallback.kind === 'ok') outcome.sandboxDeviceIds.push(result.deviceId);
          record('apns', fallback.kind === 'invalid' ? result : fallback);
        } else {
          record('apns', result);
        }
      }
      for (const result of sandboxResults) record('apns', result);
    }
  }

  if (fcmDevices.length > 0) {
    if (!input.fcm) {
      outcome.failed += fcmDevices.length;
      countError(outcome, 'fcm:not_configured', fcmDevices.length);
    } else {
      const results = await senders.fcm({
        credential: input.fcm,
        items: fcmDevices.map((device) => ({ deviceId: device.id, token: device.token })),
        message: buildFcmMessage(input.payload),
      });
      for (const result of results) record('fcm', result);
    }
  }

  return outcome;
}

function mergeErrors(
  current: Prisma.JsonValue | null,
  add: Record<string, number>,
): Record<string, number> {
  const merged: Record<string, number> = {
    ...((current as Record<string, number> | null) ?? {}),
  };
  for (const [key, value] of Object.entries(add)) merged[key] = (merged[key] ?? 0) + value;
  return merged;
}

export async function processBatch(batch: ClaimedBatch, senders?: Senders): Promise<void> {
  const campaign = await db.pushCampaign.findUnique({
    where: { id: batch.campaignId },
    include: { app: { select: { organization: { select: { usagePeriodStart: true } } } } },
  });
  if (!campaign || campaign.status === 'canceled' || campaign.status === 'failed') {
    await db.pushSendBatch.update({ where: { id: batch.id }, data: { status: 'done' } });
    return;
  }
  // A batch whose processing keeps crashing is returned to the queue by the stuck
  // sweep; stop after a few rounds so it cannot loop forever.
  if (batch.attempts > MAX_ATTEMPTS + 2) {
    await db.$transaction([
      db.pushSendBatch.update({ where: { id: batch.id }, data: { status: 'done' } }),
      db.pushCampaign.update({
        where: { id: campaign.id },
        data: { failed: { increment: batch.deviceIds.length } },
      }),
    ]);
    return;
  }

  const devices = await db.pushDevice.findMany({
    where: { id: { in: batch.deviceIds }, appId: campaign.appId },
    select: { id: true, token: true, provider: true, environment: true },
  });
  const [apns, fcm] = await Promise.all([
    devices.some((device) => device.provider === 'apns')
      ? loadApnsCredential(campaign.appId)
      : null,
    devices.some((device) => device.provider === 'fcm') ? loadFcmCredential(campaign.appId) : null,
  ]);

  const outcome = await sendToDevices({
    devices,
    payload: campaign.payload as PushPayload,
    campaignId: campaign.id,
    apns,
    fcm,
    senders,
  });

  // Devices deleted since the campaign was created are neither sent nor retried.
  const missing = batch.deviceIds.length - devices.length;
  if (missing > 0) countError(outcome, 'device_removed', missing);

  const canRetry = batch.attempts < MAX_ATTEMPTS && !outcome.authFailure;
  if (!canRetry && outcome.retryDeviceIds.length > 0) {
    outcome.failed += outcome.retryDeviceIds.length;
    countError(outcome, 'retry_exhausted', outcome.retryDeviceIds.length);
  }
  const delaySeconds = Math.max(
    RETRY_DELAYS_SECONDS[Math.min(batch.attempts - 1, RETRY_DELAYS_SECONDS.length - 1)] ?? 60,
    outcome.retryAfterSeconds,
  );
  const periodStart = pushPeriodStart(campaign.app.organization.usagePeriodStart);

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PushCampaign" WHERE id = ${campaign.id} FOR UPDATE`;
    const current = await tx.pushCampaign.findUniqueOrThrow({ where: { id: campaign.id } });

    if (outcome.invalidDeviceIds.length > 0) {
      await tx.pushDevice.deleteMany({ where: { id: { in: outcome.invalidDeviceIds } } });
    }
    if (outcome.sandboxDeviceIds.length > 0) {
      await tx.pushDevice.updateMany({
        where: { id: { in: outcome.sandboxDeviceIds } },
        data: { environment: 'sandbox' },
      });
    }
    if (canRetry && outcome.retryDeviceIds.length > 0) {
      await tx.pushSendBatch.create({
        data: {
          campaignId: campaign.id,
          deviceIds: outcome.retryDeviceIds,
          attempts: batch.attempts,
          nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
        },
      });
    }
    if (outcome.accepted > 0) {
      await tx.pushUsage.upsert({
        where: {
          organizationId_periodStart: { organizationId: campaign.organizationId, periodStart },
        },
        create: { organizationId: campaign.organizationId, periodStart, sends: outcome.accepted },
        update: { sends: { increment: outcome.accepted } },
      });
    }
    await tx.pushSendBatch.update({ where: { id: batch.id }, data: { status: 'done' } });

    if (outcome.authFailure) {
      await tx.pushSendBatch.updateMany({
        where: { campaignId: campaign.id, status: 'pending' },
        data: { status: 'done' },
      });
    }
    const unfinished = outcome.authFailure
      ? 0
      : await tx.pushSendBatch.count({
          where: { campaignId: campaign.id, status: { in: ['pending', 'sending'] } },
        });

    await tx.pushCampaign.update({
      where: { id: campaign.id },
      data: {
        accepted: { increment: outcome.accepted },
        failed: { increment: outcome.failed },
        invalidRemoved: { increment: outcome.invalidDeviceIds.length },
        errorSummary: mergeErrors(current.errorSummary, outcome.errors),
        ...(outcome.authFailure
          ? { status: 'failed', failureReason: outcome.authFailure, completedAt: new Date() }
          : unfinished === 0
            ? { status: 'completed', completedAt: new Date() }
            : { status: 'sending' }),
      },
    });
  });
}

/** Works through due batches until none are left or the time budget runs out. */
export async function deliverDueBatches(
  options: { batchesPerClaim?: number; budgetMs?: number } = {},
): Promise<{ processed: number; failedBatches: number }> {
  const { batchesPerClaim = 4, budgetMs = 240_000 } = options;
  const deadline = Date.now() + budgetMs;
  let processed = 0;
  let failedBatches = 0;

  while (Date.now() < deadline) {
    const batches = await claimBatches(batchesPerClaim);
    if (batches.length === 0) break;
    const results = await Promise.allSettled(batches.map((batch) => processBatch(batch)));
    for (const [index, result] of results.entries()) {
      processed += 1;
      if (result.status === 'rejected') {
        failedBatches += 1;
        // Left in "sending"; the stuck-batch sweep returns it to the queue.
        console.error(
          JSON.stringify({
            pushBatchFailed: batches[index].id,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          }),
        );
      }
    }
  }
  return { processed, failedBatches };
}
