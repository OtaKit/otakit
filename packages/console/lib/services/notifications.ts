import { randomUUID } from 'node:crypto';

import type {
  NotificationDelivery,
  NotificationDestination,
  NotificationDestinationType,
  Prisma,
} from '@prisma/client';

import { recordAuditLog, type AuditActor } from '@/lib/audit-log';
import { db } from '@/lib/db';
import { deliverNow, disableDestination } from '@/lib/notifications/deliver';
import { buildNotificationPayload } from '@/lib/notifications/emit';
import {
  isNotificationEventType,
  MAX_DESTINATION_NAME_LENGTH,
  NOTIFICATION_EVENTS,
  TEST_EVENT_TYPE,
  type NotificationEventType,
} from '@/lib/notifications/events';
import { validateDestinationUrl } from '@/lib/notifications/safe-fetch';
import { generateWebhookSecret } from '@/lib/notifications/signing';
import { decryptSecret, encryptSecret } from '@/lib/secret-box';

import { OtaKitServiceError } from './errors';

/** Workspace notification settings (Settings → Notifications), for owners and admins. */

export const MAX_NOTIFICATION_DESTINATIONS = 20;
/** After a rotation the old secret keeps signing this long, so receivers can switch over. */
const SECRET_OVERLAP_MS = 24 * 60 * 60 * 1000;
const DELIVERY_PAGE_SIZE = 50;
const DESTINATION_TYPES: NotificationDestinationType[] = ['email', 'webhook', 'slack', 'discord'];

export type EmailRecipients = { mode: 'owners_admins' } | { mode: 'members'; userIds: string[] };

export type NotificationDestinationView = {
  id: string;
  type: NotificationDestinationType;
  name: string;
  url: string | null;
  appId: string | null;
  emailRecipients: EmailRecipients | null;
  events: string[];
  enabled: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  createdAt: string;
};

export type NotificationDeliveryView = {
  id: string;
  eventType: string;
  status: NotificationDelivery['status'];
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
  deliveredAt: string | null;
  createdAt: string;
  payload: unknown;
};

export type NotificationsContext = { organizationId: string; actor: AuditActor };

function invalid(message: string): OtaKitServiceError {
  return new OtaKitServiceError('INVALID_INPUT', message, 400);
}

function secretAad(destinationId: string): string {
  return `notification-destination:${destinationId}`;
}

function sealSecret(secret: string, destinationId: string): string {
  try {
    return encryptSecret(secret, secretAad(destinationId));
  } catch (error) {
    console.error('[Notifications] cannot seal a webhook secret', error);
    throw new OtaKitServiceError(
      'SERVER_NOT_CONFIGURED',
      'Webhooks need DATA_ENCRYPTION_KEY on this server',
      503,
    );
  }
}

function toDestinationView(destination: NotificationDestination): NotificationDestinationView {
  return {
    id: destination.id,
    type: destination.type,
    name: destination.name,
    url: destination.url,
    appId: destination.appId,
    emailRecipients: destination.emailRecipients as EmailRecipients | null,
    events: destination.events,
    enabled: destination.enabled,
    disabledReason: destination.disabledReason,
    consecutiveFailures: destination.consecutiveFailures,
    lastSuccessAt: destination.lastSuccessAt?.toISOString() ?? null,
    createdAt: destination.createdAt.toISOString(),
  };
}

function toDeliveryView(delivery: NotificationDelivery): NotificationDeliveryView {
  return {
    id: delivery.id,
    eventType: delivery.eventType,
    status: delivery.status,
    attempts: delivery.attempts,
    nextAttemptAt: delivery.status === 'pending' ? delivery.nextAttemptAt.toISOString() : null,
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    lastStatusCode: delivery.lastStatusCode,
    lastError: delivery.lastError,
    lastDurationMs: delivery.lastDurationMs,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    payload: JSON.parse(delivery.payload) as unknown,
  };
}

function parseType(value: unknown): NotificationDestinationType {
  if (!DESTINATION_TYPES.includes(value as NotificationDestinationType)) {
    throw invalid('type must be email, webhook, slack or discord');
  }
  return value as NotificationDestinationType;
}

function parseName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > MAX_DESTINATION_NAME_LENGTH) {
    throw invalid(`Name is required (max ${MAX_DESTINATION_NAME_LENGTH} characters)`);
  }
  return name;
}

/** The chosen events, in catalog order. */
function parseEvents(value: unknown): NotificationEventType[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalid('Choose at least one event');
  }
  const unknown = value.find((event) => !isNotificationEventType(event));
  if (unknown !== undefined) throw invalid(`Unknown event: ${String(unknown)}`);
  return NOTIFICATION_EVENTS.map((event) => event.type).filter((type) => value.includes(type));
}

function parseUrl(type: NotificationDestinationType, value: unknown): string {
  const result = validateDestinationUrl(
    type as Exclude<NotificationDestinationType, 'email'>,
    value,
  );
  if ('error' in result) throw invalid(result.error);
  return result.url;
}

async function parseAppId(value: unknown, organizationId: string): Promise<string | null> {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw invalid('appId must be a string or null');
  const app = await db.app.findFirst({
    where: { id: value, organizationId },
    select: { id: true },
  });
  if (!app) throw new OtaKitServiceError('APP_NOT_FOUND', 'App not found', 404);
  return app.id;
}

async function parseEmailRecipients(
  value: unknown,
  organizationId: string,
): Promise<EmailRecipients> {
  const input = value as { mode?: unknown; userIds?: unknown } | null | undefined;
  if (input?.mode === 'owners_admins') return { mode: 'owners_admins' };
  if (input?.mode !== 'members') {
    throw invalid('emailRecipients.mode must be owners_admins or members');
  }
  const userIds = Array.isArray(input.userIds) ? Array.from(new Set(input.userIds)) : [];
  if (userIds.length === 0 || userIds.some((id) => typeof id !== 'string')) {
    throw invalid('Choose at least one member');
  }
  const members = await db.organizationMember.count({
    where: { organizationId, userId: { in: userIds as string[] } },
  });
  if (members !== userIds.length) throw invalid('Every recipient must be a member');
  return { mode: 'members', userIds: userIds as string[] };
}

async function findDestination(
  organizationId: string,
  destinationId: string,
): Promise<NotificationDestination> {
  const destination = await db.notificationDestination.findFirst({
    where: { id: destinationId, organizationId },
  });
  if (!destination) {
    throw new OtaKitServiceError(
      'NOTIFICATION_DESTINATION_NOT_FOUND',
      'Notification destination not found',
      404,
    );
  }
  return destination;
}

function auditDestination(
  context: NotificationsContext,
  action:
    | 'notification_destination.created'
    | 'notification_destination.updated'
    | 'notification_destination.deleted'
    | 'notification_destination.secret_rotated',
  destination: Pick<NotificationDestination, 'id' | 'name' | 'type'>,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  return recordAuditLog({
    organizationId: context.organizationId,
    actor: context.actor,
    action,
    targetType: 'notification_destination',
    targetId: destination.id,
    metadata: { name: destination.name, type: destination.type, ...metadata },
  });
}

export async function listNotificationSettings(organizationId: string): Promise<{
  destinations: NotificationDestinationView[];
  apps: Array<{ id: string; slug: string }>;
  members: Array<{ userId: string; email: string; role: string }>;
}> {
  const [destinations, apps, members] = await Promise.all([
    db.notificationDestination.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    }),
    db.app.findMany({
      where: { organizationId },
      orderBy: { slug: 'asc' },
      select: { id: true, slug: true },
    }),
    db.organizationMember.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, user: { select: { id: true, email: true } } },
    }),
  ]);
  return {
    destinations: destinations.map(toDestinationView),
    apps,
    members: members.map((member) => ({
      userId: member.user.id,
      email: member.user.email,
      role: member.role,
    })),
  };
}

export async function createNotificationDestination(
  context: NotificationsContext,
  body: Record<string, unknown>,
): Promise<{ destination: NotificationDestinationView; secret: string | null }> {
  const type = parseType(body.type);
  const name = parseName(body.name);
  const events = parseEvents(body.events);
  const appId = await parseAppId(body.appId, context.organizationId);
  const url = type === 'email' ? null : parseUrl(type, body.url);
  const emailRecipients =
    type === 'email'
      ? await parseEmailRecipients(body.emailRecipients, context.organizationId)
      : undefined;

  const count = await db.notificationDestination.count({
    where: { organizationId: context.organizationId },
  });
  if (count >= MAX_NOTIFICATION_DESTINATIONS) {
    throw new OtaKitServiceError(
      'NOTIFICATION_LIMIT_REACHED',
      `A workspace can have up to ${MAX_NOTIFICATION_DESTINATIONS} notification destinations`,
      409,
      'Delete a destination you no longer use.',
    );
  }

  const id = randomUUID();
  const secret = type === 'webhook' ? generateWebhookSecret() : null;
  const destination = await db.notificationDestination.create({
    data: {
      id,
      organizationId: context.organizationId,
      appId,
      type,
      name,
      url,
      emailRecipients,
      secretCiphertext: secret ? sealSecret(secret, id) : null,
      events,
    },
  });
  await auditDestination(context, 'notification_destination.created', destination, {
    events,
    appId,
  });
  return { destination: toDestinationView(destination), secret };
}

export async function updateNotificationDestination(
  context: NotificationsContext,
  destinationId: string,
  body: Record<string, unknown>,
): Promise<NotificationDestinationView> {
  const existing = await findDestination(context.organizationId, destinationId);
  const fields: Partial<
    Pick<NotificationDestination, 'name' | 'events' | 'appId' | 'url' | 'emailRecipients'>
  > = {};
  if ('name' in body) fields.name = parseName(body.name);
  if ('events' in body) fields.events = parseEvents(body.events);
  if ('appId' in body) fields.appId = await parseAppId(body.appId, context.organizationId);
  if ('url' in body) {
    if (existing.type === 'email') throw invalid('Email destinations have no URL');
    fields.url = parseUrl(existing.type, body.url);
  }
  if ('emailRecipients' in body) {
    if (existing.type !== 'email') throw invalid('Only email destinations have recipients');
    fields.emailRecipients = await parseEmailRecipients(
      body.emailRecipients,
      context.organizationId,
    );
  }
  if ('enabled' in body && typeof body.enabled !== 'boolean') {
    throw invalid('enabled must be true or false');
  }

  // Only what actually changed is written and audited (the dashboard sends every field).
  const data: Prisma.NotificationDestinationUncheckedUpdateInput = {};
  const changes: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (JSON.stringify(value) !== JSON.stringify(existing[key as keyof typeof fields])) {
      Object.assign(data, { [key]: value });
      changes.push(key);
    }
  }
  if (body.enabled === true && !existing.enabled) {
    Object.assign(data, { enabled: true, disabledReason: null, consecutiveFailures: 0 });
    changes.push('enabled');
  }

  if (Object.keys(data).length > 0) {
    await db.notificationDestination.update({ where: { id: existing.id }, data });
  }
  if (body.enabled === false && existing.enabled) {
    await disableDestination(db, existing.id, null);
    changes.push('enabled');
  }
  const updated = await findDestination(context.organizationId, existing.id);
  if (changes.length > 0) {
    await auditDestination(context, 'notification_destination.updated', updated, {
      changes,
      ...(changes.includes('enabled') ? { enabled: updated.enabled } : {}),
    });
  }
  return toDestinationView(updated);
}

export async function deleteNotificationDestination(
  context: NotificationsContext,
  destinationId: string,
): Promise<void> {
  const existing = await findDestination(context.organizationId, destinationId);
  await db.notificationDestination.delete({ where: { id: existing.id } });
  await auditDestination(context, 'notification_destination.deleted', existing);
}

/** Send a signed test.ping now and return the delivery with its outcome. */
export async function sendTestNotification(
  context: NotificationsContext,
  destinationId: string,
): Promise<NotificationDeliveryView> {
  const destination = await findDestination(context.organizationId, destinationId);
  const key = `${TEST_EVENT_TYPE}:${randomUUID()}`;
  const payload = await buildNotificationPayload(db, {
    type: TEST_EVENT_TYPE,
    key,
    organizationId: context.organizationId,
    appId: null,
    actor: context.actor,
    data: { message: 'This destination receives OtaKit notifications.' },
  });
  const delivery = await db.notificationDelivery.create({
    data: {
      destinationId: destination.id,
      eventType: TEST_EVENT_TYPE,
      eventKey: key,
      payload: JSON.stringify(payload),
    },
  });
  await deliverNow(delivery.id);
  return toDeliveryView(
    await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
  );
}

async function findWebhook(
  organizationId: string,
  destinationId: string,
): Promise<NotificationDestination & { secretCiphertext: string }> {
  const destination = await findDestination(organizationId, destinationId);
  if (destination.type !== 'webhook' || !destination.secretCiphertext) {
    throw invalid('Only webhooks have a signing secret');
  }
  return destination as NotificationDestination & { secretCiphertext: string };
}

export async function revealWebhookSecret(
  organizationId: string,
  destinationId: string,
): Promise<string> {
  const destination = await findWebhook(organizationId, destinationId);
  return decryptSecret(destination.secretCiphertext, secretAad(destination.id));
}

/** New signing secret; the old one keeps signing for 24 hours alongside it. */
export async function rotateWebhookSecret(
  context: NotificationsContext,
  destinationId: string,
): Promise<string> {
  const destination = await findWebhook(context.organizationId, destinationId);
  const secret = generateWebhookSecret();
  await db.notificationDestination.update({
    where: { id: destination.id },
    data: {
      secretCiphertext: sealSecret(secret, destination.id),
      previousSecretCiphertext: destination.secretCiphertext,
      previousSecretExpiresAt: new Date(Date.now() + SECRET_OVERLAP_MS),
    },
  });
  await auditDestination(context, 'notification_destination.secret_rotated', destination);
  return secret;
}

export async function listNotificationDeliveries(
  organizationId: string,
  destinationId: string,
): Promise<NotificationDeliveryView[]> {
  const destination = await findDestination(organizationId, destinationId);
  const deliveries = await db.notificationDelivery.findMany({
    where: { destinationId: destination.id },
    orderBy: { createdAt: 'desc' },
    take: DELIVERY_PAGE_SIZE,
  });
  return deliveries.map(toDeliveryView);
}

/** Attempt a delivery again now, with a fresh retry schedule if it fails. */
export async function redeliverNotification(
  organizationId: string,
  destinationId: string,
  deliveryId: string,
): Promise<NotificationDeliveryView> {
  const destination = await findDestination(organizationId, destinationId);
  const delivery = await db.notificationDelivery.findFirst({
    where: { id: deliveryId, destinationId: destination.id },
  });
  if (!delivery) {
    throw new OtaKitServiceError('NOTIFICATION_DELIVERY_NOT_FOUND', 'Delivery not found', 404);
  }
  if (!destination.enabled && delivery.eventType !== TEST_EVENT_TYPE) {
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'This destination is turned off',
      409,
      'Turn it on, then redeliver.',
    );
  }
  if (delivery.status !== 'sending') {
    await db.notificationDelivery.updateMany({
      where: { id: delivery.id, status: { not: 'sending' } },
      data: { status: 'pending', attempts: 0, nextAttemptAt: new Date(), claimedAt: null },
    });
    await deliverNow(delivery.id);
  }
  return toDeliveryView(
    await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
  );
}
