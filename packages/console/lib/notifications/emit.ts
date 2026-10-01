import type { NotificationDestination, Prisma, PrismaClient } from '@prisma/client';

import type { AuditActor } from '@/lib/audit-log';

import {
  DEFAULT_EMAIL_DESTINATION_NAME,
  DEFAULT_EMAIL_EVENTS,
  type NotificationActor,
  type NotificationEventFields,
  type NotificationPayload,
} from './events';

type Database = PrismaClient | Prisma.TransactionClient;

export type NotificationEvent = NotificationEventFields & {
  organizationId: string;
  /** The app the event is about; null for workspace-wide events. */
  appId: string | null;
  /**
   * Identifies the event. A destination gets at most one delivery per key, so
   * replays and retried writes never notify twice.
   */
  key: string;
  actor: AuditActor | null;
};

export function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
}

export function notificationActor(actor: AuditActor | null): NotificationActor | null {
  if (!actor) return null;
  return {
    type: actor.actorType === 'key' ? 'api_key' : actor.actorType,
    label: actor.actorLabel,
  };
}

export async function buildNotificationPayload(
  database: Database,
  event: NotificationEvent,
): Promise<NotificationPayload> {
  const organization = await database.organization.findUniqueOrThrow({
    where: { id: event.organizationId },
    select: { id: true, name: true },
  });
  const app = event.appId
    ? await database.app.findUniqueOrThrow({
        where: { id: event.appId },
        select: { id: true, slug: true },
      })
    : null;
  return {
    type: event.type,
    timestamp: new Date().toISOString(),
    data: {
      organization,
      app,
      actor: notificationActor(event.actor),
      url: app
        ? `${appUrl()}/dashboard?app=${encodeURIComponent(app.id)}`
        : `${appUrl()}/dashboard/settings`,
      ...event.data,
    },
  } as NotificationPayload;
}

/**
 * Queue one delivery of the event for every enabled destination of the workspace
 * that subscribes to it. Call it inside the transaction that makes the change, so
 * the notification exists exactly when the change committed. Returns the number
 * of deliveries queued; deliver them after commit (scheduleNotificationDelivery).
 */
export async function emitNotification(
  database: Database,
  event: NotificationEvent,
): Promise<number> {
  const destinations = await database.notificationDestination.findMany({
    where: {
      organizationId: event.organizationId,
      enabled: true,
      events: { has: event.type },
      // Workspace-wide events reach every subscribed destination.
      ...(event.appId ? { OR: [{ appId: null }, { appId: event.appId }] } : {}),
    },
    select: { id: true },
  });
  if (destinations.length === 0) return 0;

  const payload = await buildNotificationPayload(database, event);
  const created = await database.notificationDelivery.createMany({
    data: destinations.map((destination) => ({
      destinationId: destination.id,
      eventType: event.type,
      eventKey: event.key,
      payload: JSON.stringify(payload),
    })),
    skipDuplicates: true,
  });
  return created.count;
}

/** The destination every new workspace starts with; see the notifications migration. */
export function createDefaultNotificationDestination(
  database: Database,
  organizationId: string,
): Promise<NotificationDestination> {
  return database.notificationDestination.create({
    data: {
      organizationId,
      type: 'email',
      name: DEFAULT_EMAIL_DESTINATION_NAME,
      emailRecipients: { mode: 'owners_admins' },
      events: DEFAULT_EMAIL_EVENTS,
    },
  });
}

/** The bundle.uploaded event, shared by both finalize routes. */
export function bundleUploadedEvent(input: {
  organizationId: string;
  appId: string;
  actor: AuditActor;
  bundle: {
    id: string;
    version: string;
    runtimeVersion: string | null;
    size: number;
    strategy: string;
    createdAt: Date;
  };
}): NotificationEvent {
  const { bundle } = input;
  return {
    type: 'bundle.uploaded',
    key: `bundle.uploaded:${bundle.id}`,
    organizationId: input.organizationId,
    appId: input.appId,
    actor: input.actor,
    data: {
      bundle: {
        id: bundle.id,
        version: bundle.version,
        runtimeVersion: bundle.runtimeVersion,
        size: bundle.size,
        strategy: bundle.strategy,
        createdAt: bundle.createdAt.toISOString(),
      },
    },
  };
}
