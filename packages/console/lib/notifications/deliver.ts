import type {
  NotificationDestination,
  NotificationDestinationType,
  PrismaClient,
} from '@prisma/client';
import { after } from 'next/server';

import { db } from '@/lib/db';
import { escapeHtml, sendNotificationEmail } from '@/lib/email';
import { decryptSecret } from '@/lib/secret-box';

import { TEST_EVENT_TYPE, type NotificationPayload } from './events';
import { discordMessage, emailMessage, slackMessage } from './format';
import { postJson } from './safe-fetch';
import { signWebhook } from './signing';

/**
 * Delivery of queued notifications (the outbox rows emitNotification writes).
 * Workers claim due rows with SKIP LOCKED, so the request that made a change,
 * the per-minute cron and a redelivery can all run at once without sending
 * anything twice. Failed attempts retry on the Standard Webhooks schedule for
 * about 28 hours.
 */

export const MAX_ATTEMPTS = 8;
/** Wait before attempt n + 1, indexed by n - 1. */
export const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200, 18_000, 36_000, 36_000];
export const USER_AGENT = 'OtaKit-Webhooks/1.0';
const DISABLE_AFTER_FAILURES = 5;
const DISABLE_AFTER_MS = 72 * 60 * 60 * 1000;
const STUCK_AFTER_MINUTES = 5;
const CLAIM_BATCH = 20;
const CONCURRENCY = 10;
const RETENTION_DAYS = 30;
const MAX_ERROR_LENGTH = 500;

type Database = PrismaClient;

type ClaimedDelivery = {
  id: string;
  destinationId: string;
  eventType: string;
  /** The JSON body, sent to webhooks byte for byte. */
  payload: string;
  attempts: number;
};

type SendOutcome = {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  /** HTTP 410: the receiver says the endpoint is gone for good. */
  gone: boolean;
};

export type DeliveryRunStats = { claimed: number; delivered: number; failed: number };

/** Seconds to wait after `attempts` failed attempts, or null when none are left. */
export function retryDelaySeconds(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return RETRY_DELAYS_SECONDS[Math.max(0, attempts - 1)];
}

function truncateError(message: string): string {
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
}

function isUrlType(type: NotificationDestinationType): boolean {
  return type !== 'email';
}

// Prisma stores DateTime as UTC in `timestamp without time zone` columns, so raw
// SQL compares them with UTC now, whatever the session's TimeZone is.

/** Return rows a crashed worker left in `sending` to the queue. */
async function releaseStuck(database: Database): Promise<void> {
  await database.$executeRaw`
    UPDATE "NotificationDelivery"
    SET status = 'pending', "claimedAt" = NULL
    WHERE status = 'sending'
      AND "claimedAt" < (now() AT TIME ZONE 'UTC') - (${STUCK_AFTER_MINUTES} * interval '1 minute')`;
}

async function claimDue(database: Database, limit: number): Promise<ClaimedDelivery[]> {
  return database.$queryRaw<ClaimedDelivery[]>`
    UPDATE "NotificationDelivery"
    SET status = 'sending', "claimedAt" = (now() AT TIME ZONE 'UTC'), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "NotificationDelivery"
      WHERE status = 'pending' AND "nextAttemptAt" <= (now() AT TIME ZONE 'UTC')
      ORDER BY "nextAttemptAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "destinationId", "eventType", payload, attempts`;
}

/** Claim one delivery for an immediate attempt ("Send test"), if nobody else holds it. */
async function claimOne(database: Database, id: string): Promise<ClaimedDelivery | null> {
  const rows = await database.$queryRaw<ClaimedDelivery[]>`
    UPDATE "NotificationDelivery"
    SET status = 'sending', "claimedAt" = (now() AT TIME ZONE 'UTC'), attempts = attempts + 1
    WHERE id = ${id} AND status = 'pending'
    RETURNING id, "destinationId", "eventType", payload, attempts`;
  return rows[0] ?? null;
}

function webhookSecrets(destination: NotificationDestination, now: Date): string[] {
  if (!destination.secretCiphertext) throw new Error('Webhook has no signing secret');
  const aad = `notification-destination:${destination.id}`;
  const secrets = [decryptSecret(destination.secretCiphertext, aad)];
  if (
    destination.previousSecretCiphertext &&
    destination.previousSecretExpiresAt &&
    destination.previousSecretExpiresAt > now
  ) {
    secrets.push(decryptSecret(destination.previousSecretCiphertext, aad));
  }
  return secrets;
}

function httpOutcome(result: { statusCode: number; body: string; location: string | null }) {
  const { statusCode } = result;
  if (statusCode >= 200 && statusCode < 300) {
    return { ok: true, statusCode, error: null, gone: false };
  }
  let error = `HTTP ${statusCode}`;
  if (statusCode >= 300 && statusCode < 400) {
    error += `: redirects are not followed${result.location ? ` (to ${result.location})` : ''}`;
  } else if (result.body.trim()) {
    error += `: ${result.body.trim()}`;
  }
  return { ok: false, statusCode, error: truncateError(error), gone: statusCode === 410 };
}

/** Members who receive an email destination's notifications, resolved at send time. */
export async function emailRecipients(
  database: Database,
  destination: Pick<NotificationDestination, 'organizationId' | 'emailRecipients'>,
): Promise<string[]> {
  const setting = destination.emailRecipients as {
    mode?: string;
    userIds?: unknown;
  } | null;
  const userIds =
    setting?.mode === 'members' && Array.isArray(setting.userIds)
      ? setting.userIds.filter((id): id is string => typeof id === 'string')
      : null;
  const members = await database.organizationMember.findMany({
    where: {
      organizationId: destination.organizationId,
      ...(userIds ? { userId: { in: userIds } } : { role: { in: ['owner', 'admin'] } }),
    },
    select: { user: { select: { email: true } } },
  });
  return Array.from(new Set(members.map((member) => member.user.email)));
}

async function send(
  database: Database,
  destination: NotificationDestination,
  delivery: ClaimedDelivery,
  now: Date,
): Promise<SendOutcome> {
  const userAgent = { 'user-agent': USER_AGENT };
  try {
    const payload = JSON.parse(delivery.payload) as NotificationPayload;
    switch (destination.type) {
      case 'webhook': {
        const body = delivery.payload;
        const timestamp = Math.floor(now.getTime() / 1000);
        const signature = signWebhook({
          id: delivery.id,
          timestamp,
          body,
          secrets: webhookSecrets(destination, now),
        });
        return httpOutcome(
          await postJson(destination.url ?? '', body, {
            ...userAgent,
            'webhook-id': delivery.id,
            'webhook-timestamp': String(timestamp),
            'webhook-signature': signature,
          }),
        );
      }
      case 'slack':
        return httpOutcome(
          await postJson(destination.url ?? '', JSON.stringify(slackMessage(payload)), userAgent),
        );
      case 'discord':
        return httpOutcome(
          await postJson(destination.url ?? '', JSON.stringify(discordMessage(payload)), userAgent),
        );
      case 'email': {
        const recipients = await emailRecipients(database, destination);
        const message = emailMessage(payload, destination.name);
        const results = await Promise.allSettled(
          recipients.map((to) =>
            sendNotificationEmail({
              to,
              ...message,
              idempotencyKey: `notification:${delivery.id}:${to}`,
            }),
          ),
        );
        const failure = results.find((result) => result.status === 'rejected');
        if (failure) {
          const reason = (failure as PromiseRejectedResult).reason;
          return {
            ok: false,
            statusCode: null,
            error: truncateError(reason instanceof Error ? reason.message : 'Email failed'),
            gone: false,
          };
        }
        return { ok: true, statusCode: null, error: null, gone: false };
      }
    }
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      error: truncateError(error instanceof Error ? error.message : 'Delivery failed'),
      gone: false,
    };
  }
}

/**
 * Turn a destination off and fail what it still had queued. Returns false when it
 * was already off, so only one caller reports the change.
 */
export async function disableDestination(
  database: Database,
  destinationId: string,
  reason: 'endpoint_gone' | 'failing' | null,
): Promise<boolean> {
  const [turnedOff] = await database.$transaction([
    database.notificationDestination.updateMany({
      where: { id: destinationId, enabled: true },
      data: { enabled: false, disabledReason: reason },
    }),
    database.notificationDelivery.updateMany({
      where: { destinationId, status: 'pending' },
      data: { status: 'failed', lastError: 'Destination turned off' },
    }),
  ]);
  return turnedOff.count === 1;
}

/** Tell the owners and admins that OtaKit turned a destination off. */
async function alertDisabled(
  database: Database,
  destination: NotificationDestination,
  reason: 'endpoint_gone' | 'failing',
): Promise<void> {
  const organization = await database.organization.findUnique({
    where: { id: destination.organizationId },
    select: { name: true },
  });
  const recipients = await emailRecipients(database, {
    organizationId: destination.organizationId,
    emailRecipients: { mode: 'owners_admins' },
  });
  const target = destination.url ? new URL(destination.url).host : destination.name;
  const why =
    reason === 'endpoint_gone'
      ? `${target} answered 410 Gone, so OtaKit turned "${destination.name}" off.`
      : `OtaKit could not deliver to ${target} for 3 days, so it turned "${destination.name}" off.`;
  const next = 'Fix the endpoint, then turn the destination back on in Settings → Notifications.';
  const subject = `Notifications to "${destination.name}" turned off (${organization?.name ?? 'OtaKit'})`;
  await Promise.allSettled(
    recipients.map((to) =>
      sendNotificationEmail({
        to,
        subject,
        html: `<p>${escapeHtml(why)}</p>\n<p>${escapeHtml(next)}</p>`,
        text: `${why}\n${next}`,
      }),
    ),
  );
}

async function record(
  database: Database,
  destination: NotificationDestination,
  delivery: ClaimedDelivery,
  outcome: SendOutcome,
  startedAt: Date,
): Promise<'delivered' | 'retry' | 'failed'> {
  const now = new Date();
  const attempt = {
    claimedAt: null,
    lastAttemptAt: startedAt,
    lastStatusCode: outcome.statusCode,
    lastDurationMs: now.getTime() - startedAt.getTime(),
  };

  if (outcome.ok) {
    await database.notificationDelivery.update({
      where: { id: delivery.id },
      data: { ...attempt, status: 'delivered', deliveredAt: now, lastError: null },
    });
    await database.notificationDestination.update({
      where: { id: destination.id },
      data: { consecutiveFailures: 0, lastSuccessAt: now },
    });
    return 'delivered';
  }

  const gone = outcome.gone && isUrlType(destination.type);
  const delay =
    gone || delivery.eventType === TEST_EVENT_TYPE ? null : retryDelaySeconds(delivery.attempts);
  await database.notificationDelivery.update({
    where: { id: delivery.id },
    data: {
      ...attempt,
      lastError: outcome.error,
      ...(delay === null
        ? { status: 'failed' }
        : { status: 'pending', nextAttemptAt: new Date(now.getTime() + delay * 1000) }),
    },
  });
  const updated = await database.notificationDestination.update({
    where: { id: destination.id },
    data: { consecutiveFailures: { increment: 1 } },
  });

  let disableReason: 'endpoint_gone' | 'failing' | null = null;
  if (gone) {
    disableReason = 'endpoint_gone';
  } else if (
    isUrlType(destination.type) &&
    updated.consecutiveFailures >= DISABLE_AFTER_FAILURES &&
    (updated.lastSuccessAt ?? updated.createdAt).getTime() <= now.getTime() - DISABLE_AFTER_MS
  ) {
    disableReason = 'failing';
  }
  if (disableReason && (await disableDestination(database, destination.id, disableReason))) {
    await alertDisabled(database, updated, disableReason).catch((error) =>
      console.error('[Notifications] disabled alert failed', { id: destination.id, error }),
    );
  }
  return delay === null ? 'failed' : 'retry';
}

async function attemptAll(
  database: Database,
  claimed: ClaimedDelivery[],
  stats: DeliveryRunStats,
): Promise<void> {
  const destinations = await database.notificationDestination.findMany({
    where: { id: { in: Array.from(new Set(claimed.map((row) => row.destinationId))) } },
  });
  const byId = new Map(destinations.map((destination) => [destination.id, destination]));

  for (let index = 0; index < claimed.length; index += CONCURRENCY) {
    const results = await Promise.allSettled(
      claimed.slice(index, index + CONCURRENCY).map(async (delivery) => {
        const destination = byId.get(delivery.destinationId);
        // Deliveries cascade with their destination, so it was deleted mid-run.
        if (!destination) return;
        if (!destination.enabled && delivery.eventType !== TEST_EVENT_TYPE) {
          await database.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: 'failed', claimedAt: null, lastError: 'Destination turned off' },
          });
          stats.failed += 1;
          return;
        }
        const startedAt = new Date();
        const outcome = await send(database, destination, delivery, startedAt);
        const result = await record(database, destination, delivery, outcome, startedAt);
        if (result === 'delivered') stats.delivered += 1;
        if (result === 'failed') stats.failed += 1;
      }),
    );
    // A row left in `sending` by a failed write is retried after STUCK_AFTER_MINUTES.
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[Notifications] recording a delivery failed', result.reason);
      }
    }
  }
}

/** Deliver what is due, in batches, until nothing is due or the time budget is spent. */
export async function deliverDueNotifications(
  options: { budgetMs?: number } = {},
  database: Database = db,
): Promise<DeliveryRunStats> {
  const budgetMs = options.budgetMs ?? 60_000;
  const startedAt = Date.now();
  const stats: DeliveryRunStats = { claimed: 0, delivered: 0, failed: 0 };
  await releaseStuck(database);
  while (Date.now() - startedAt < budgetMs) {
    const claimed = await claimDue(database, CLAIM_BATCH);
    if (claimed.length === 0) break;
    stats.claimed += claimed.length;
    await attemptAll(database, claimed, stats);
  }
  return stats;
}

/** Attempt one queued delivery now and return it ("Send test", "Redeliver"). */
export async function deliverNow(id: string, database: Database = db): Promise<void> {
  const claimed = await claimOne(database, id);
  if (!claimed) return;
  await attemptAll(database, [claimed], { claimed: 1, delivered: 0, failed: 0 });
}

/** Delete delivery records past retention. */
export async function pruneNotificationDeliveries(database: Database = db): Promise<number> {
  const result = await database.notificationDelivery.deleteMany({
    where: {
      createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000) },
      status: { in: ['delivered', 'failed'] },
    },
  });
  return result.count;
}

/**
 * Deliver right after the current response, so a release reaches Slack in
 * seconds instead of at the next cron run. Outside a request (scripts, tests)
 * the cron picks the rows up instead.
 */
export function scheduleNotificationDelivery(): void {
  try {
    after(async () => {
      await deliverDueNotifications({ budgetMs: 20_000 }).catch((error) =>
        console.error('[Notifications] immediate delivery failed', error),
      );
    });
  } catch {
    // Not inside a request scope.
  }
}
