import {
  Prisma,
  type NotificationDestination,
  type NotificationDestinationType,
  type PrismaClient,
} from '@prisma/client';
import { after } from 'next/server';

import { recordAuditLog } from '@/lib/audit-log';
import { db } from '@/lib/db';
import { escapeHtml, sendNotificationEmail } from '@/lib/email';
import { decryptSecret } from '@/lib/secret-box';

import { appUrl, emitNotification, type NotificationEvent } from './emit';
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
/** URL destinations that have failed this long, with no success in between, are turned off. */
const DISABLE_AFTER_MS = 72 * 60 * 60 * 1000;
const STUCK_AFTER_MINUTES = 5;
const CLAIM_BATCH = 20;
/** At most this many deliveries per destination in one batch, so one slow endpoint cannot hold up the rest. */
const CLAIM_PER_DESTINATION = 5;
const CONCURRENCY = 10;
const EMAIL_TIMEOUT_MS = 10_000;
const RETENTION_DAYS = 30;
const MAX_ERROR_LENGTH = 500;

type Database = PrismaClient;

type ClaimedDelivery = {
  id: string;
  destinationId: string;
  eventType: string;
  eventId: string;
  /** The JSON body, sent to webhooks byte for byte. */
  payload: string;
  attempts: number;
  emailSentTo: string[];
  redeliveries: number;
};

const CLAIMED_COLUMNS = Prisma.sql`id, "destinationId", "eventType", "eventId", payload, attempts, "emailSentTo", redeliveries`;

type SendOutcome = {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  /** The receiver says the endpoint is gone for good (HTTP 410, a deleted Slack or Discord hook). */
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

/**
 * Return rows a crashed worker left in `sending` to the queue, or fail them
 * when that was their last attempt (a worker killed on every attempt must not
 * loop forever).
 */
async function releaseStuck(database: Database): Promise<void> {
  await database.$executeRaw`
    UPDATE "NotificationDelivery"
    SET status = CASE WHEN attempts >= ${MAX_ATTEMPTS}
          THEN 'failed'::"NotificationDeliveryStatus"
          ELSE 'pending'::"NotificationDeliveryStatus" END,
        "claimedAt" = NULL,
        "lastError" = CASE WHEN attempts >= ${MAX_ATTEMPTS}
          THEN 'The last attempt did not finish' ELSE "lastError" END
    WHERE status = 'sending'
      AND "claimedAt" < (now() AT TIME ZONE 'UTC') - (${STUCK_AFTER_MINUTES} * interval '1 minute')`;
}

async function claimDue(database: Database, limit: number): Promise<ClaimedDelivery[]> {
  // FOR UPDATE cannot sit next to a window function, so the per-destination
  // cap ranks candidates first and the outer select locks them.
  return database.$queryRaw<ClaimedDelivery[]>`
    UPDATE "NotificationDelivery"
    SET status = 'sending', "claimedAt" = (now() AT TIME ZONE 'UTC'), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "NotificationDelivery"
      WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (
            PARTITION BY "destinationId" ORDER BY "nextAttemptAt", id
          ) AS rank
          FROM "NotificationDelivery"
          WHERE status = 'pending'
            AND "nextAttemptAt" <= (now() AT TIME ZONE 'UTC')
            AND attempts < ${MAX_ATTEMPTS}
        ) ranked
        WHERE rank <= ${CLAIM_PER_DESTINATION}
      )
        AND status = 'pending'
      ORDER BY "nextAttemptAt", id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING ${CLAIMED_COLUMNS}`;
}

/** Claim one delivery for an immediate attempt ("Send test"), if nobody else holds it. */
async function claimOne(database: Database, id: string): Promise<ClaimedDelivery | null> {
  const rows = await database.$queryRaw<ClaimedDelivery[]>`
    UPDATE "NotificationDelivery"
    SET status = 'sending', "claimedAt" = (now() AT TIME ZONE 'UTC'), attempts = attempts + 1
    WHERE id = ${id} AND status = 'pending'
    RETURNING ${CLAIMED_COLUMNS}`;
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

/**
 * Whether the receiver says the endpoint no longer exists. Slack answers a
 * removed or disabled incoming webhook with 404 `no_service` (403
 * `invalid_token` for a revoked one); Discord answers a deleted webhook with
 * 404 (code 10015) or 401 (code 50027).
 */
export function isGoneResponse(
  type: NotificationDestinationType,
  statusCode: number,
  body: string,
): boolean {
  if (statusCode === 410) return true;
  const text = body.trim();
  if (type === 'slack') {
    return (
      (statusCode === 404 && /^(no_service|no_team)\b/.test(text)) ||
      (statusCode === 403 && /^invalid_token\b/.test(text))
    );
  }
  if (type === 'discord') {
    return (statusCode === 404 || statusCode === 401) && /"code"\s*:\s*(10015|50027)\b/.test(text);
  }
  return false;
}

function httpOutcome(
  type: NotificationDestinationType,
  result: { statusCode: number; body: string; location: string | null },
): SendOutcome {
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
  return {
    ok: false,
    statusCode,
    error: truncateError(error),
    gone: isGoneResponse(type, statusCode, result.body),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
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

/**
 * Email each recipient who has not received this delivery yet. Successful
 * sends are recorded at once, so a retry (hours later, past the email
 * provider's 24-hour idempotency window) only reaches the ones that failed.
 */
async function sendEmail(
  database: Database,
  destination: NotificationDestination,
  delivery: ClaimedDelivery,
  payload: NotificationPayload,
): Promise<SendOutcome> {
  const recipients = await emailRecipients(database, destination);
  if (recipients.length === 0) {
    return {
      ok: false,
      statusCode: null,
      error: 'No recipients: everyone this destination emails has left the workspace',
      gone: false,
    };
  }
  const alreadySent = new Set(delivery.emailSentTo);
  const remaining = recipients.filter((to) => !alreadySent.has(to));
  const message = emailMessage(payload, destination.name);
  const results = await Promise.allSettled(
    remaining.map((to) =>
      withTimeout(
        sendNotificationEmail({
          to,
          ...message,
          idempotencyKey: `notification:${delivery.id}:${delivery.redeliveries}:${to}`,
        }),
        EMAIL_TIMEOUT_MS,
        'The email provider did not answer in time',
      ),
    ),
  );
  const sent = remaining.filter((_, index) => results[index].status === 'fulfilled');
  if (sent.length > 0) {
    await database.$executeRaw`
      UPDATE "NotificationDelivery"
      SET "emailSentTo" = ARRAY(SELECT DISTINCT unnest("emailSentTo" || ${sent}::text[]))
      WHERE id = ${delivery.id}`;
  }
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) {
    const reason = failure.reason instanceof Error ? failure.reason.message : 'Email failed';
    const failed = remaining.length - sent.length;
    return {
      ok: false,
      statusCode: null,
      error: truncateError(
        `Sent to ${recipients.length - failed} of ${recipients.length} recipients; ${reason}`,
      ),
      gone: false,
    };
  }
  return { ok: true, statusCode: null, error: null, gone: false };
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
        // One ID per event: retries, redeliveries and other destinations of the
        // same event share it, so receivers can deduplicate.
        const signature = signWebhook({
          id: delivery.eventId,
          timestamp,
          body,
          secrets: webhookSecrets(destination, now),
        });
        return httpOutcome(
          destination.type,
          await postJson(destination.url ?? '', body, {
            ...userAgent,
            'webhook-id': delivery.eventId,
            'webhook-timestamp': String(timestamp),
            'webhook-signature': signature,
          }),
        );
      }
      case 'slack':
        return httpOutcome(
          destination.type,
          await postJson(destination.url ?? '', JSON.stringify(slackMessage(payload)), userAgent),
        );
      case 'discord':
        return httpOutcome(
          destination.type,
          await postJson(destination.url ?? '', JSON.stringify(discordMessage(payload)), userAgent),
        );
      case 'email':
        return await sendEmail(database, destination, delivery, payload);
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
      ? `${target} says this endpoint no longer exists, so OtaKit turned "${destination.name}" off.`
      : `Every delivery to ${target} has failed for 3 days, so OtaKit turned "${destination.name}" off.`;
  const next = 'Fix the endpoint, then turn the destination back on in Settings → Notifications.';
  const settingsUrl = `${appUrl()}/dashboard/settings?org=${encodeURIComponent(destination.organizationId)}#notifications`;
  const subject = `Notifications to "${destination.name}" turned off (${organization?.name ?? 'OtaKit'})`;
  await Promise.allSettled(
    recipients.map((to) =>
      sendNotificationEmail({
        to,
        subject,
        html: `<p>${escapeHtml(why)}</p>\n<p>${escapeHtml(next)}</p>\n<p><a href="${escapeHtml(settingsUrl)}">Notification settings</a></p>`,
        text: `${why}\n${next}\nNotification settings: ${settingsUrl}`,
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
      data: { consecutiveFailures: 0, failingSince: null, lastSuccessAt: now },
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
  // One statement, so parallel failures of the same destination keep the
  // earliest failingSince and count every failure.
  const [updated] = await database.$queryRaw<NotificationDestination[]>`
    UPDATE "NotificationDestination"
    SET "consecutiveFailures" = "consecutiveFailures" + 1,
        "failingSince" = COALESCE("failingSince", now() AT TIME ZONE 'UTC'),
        "updatedAt" = now() AT TIME ZONE 'UTC'
    WHERE id = ${destination.id}
    RETURNING *`;
  if (!updated) return delay === null ? 'failed' : 'retry';

  let disableReason: 'endpoint_gone' | 'failing' | null = null;
  if (gone) {
    disableReason = 'endpoint_gone';
  } else if (
    isUrlType(destination.type) &&
    updated.consecutiveFailures >= DISABLE_AFTER_FAILURES &&
    updated.failingSince !== null &&
    updated.failingSince.getTime() <= now.getTime() - DISABLE_AFTER_MS
  ) {
    disableReason = 'failing';
  }
  if (disableReason && (await disableDestination(database, destination.id, disableReason))) {
    await recordAuditLog({
      organizationId: destination.organizationId,
      actor: { actorType: 'system', actorLabel: 'notifications' },
      action: 'notification_destination.turned_off',
      targetType: 'notification_destination',
      targetId: destination.id,
      metadata: {
        name: destination.name,
        type: destination.type,
        reason: disableReason,
        lastError: outcome.error,
      },
    });
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

/**
 * Queue an event after its change was already written outside a transaction
 * (the legacy release path), and deliver it. The change has happened, so a
 * failure here is logged and never turns a successful request into an error.
 */
export async function emitNotificationAfterCommit(
  database: Database | Prisma.TransactionClient,
  event: NotificationEvent,
): Promise<void> {
  try {
    if ((await emitNotification(database, event)) > 0) scheduleNotificationDelivery();
  } catch (error) {
    console.error('[Notifications] could not queue an event', {
      type: event.type,
      key: event.key,
      error,
    });
  }
}
