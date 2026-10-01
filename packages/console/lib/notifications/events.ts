import type { ReleaseSummary } from '@/lib/services/releases';

/**
 * The notification catalog. Type names are part of the public webhook contract:
 * add new ones, never rename. Safe to import from client components.
 */
export const NOTIFICATION_EVENTS = [
  {
    type: 'release.published',
    label: 'Release published',
    description: 'A bundle is released to a channel',
    group: 'Releases',
  },
  {
    type: 'release.rollout_updated',
    label: 'Rollout changed',
    description: 'A gradual rollout moves to a new percentage or completes',
    group: 'Releases',
  },
  {
    type: 'release.reverted',
    label: 'Release reverted',
    description: 'Someone reverts a release or cancels a rollout',
    group: 'Releases',
  },
  {
    type: 'release.auto_reverted',
    label: 'Auto-reverted',
    description: 'Too many devices rolled back, so OtaKit reverted the release',
    group: 'Release health',
  },
  {
    type: 'release.auto_revert_suppressed',
    label: 'Auto-revert suppressed',
    description: 'A release is unhealthy but was not reverted; action needed',
    group: 'Release health',
  },
  {
    type: 'bundle.uploaded',
    label: 'Bundle uploaded',
    description: 'A new bundle is uploaded',
    group: 'Bundles',
  },
  {
    type: 'usage.warning',
    label: 'Usage warning',
    description: 'Monthly downloads reach 90% or 100% of the plan',
    group: 'Billing',
  },
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENTS)[number]['type'];

/** Sent by "Send test" only; destinations cannot subscribe to it. */
export const TEST_EVENT_TYPE = 'test.ping';

export type NotificationPayloadType = NotificationEventType | typeof TEST_EVENT_TYPE;

/** What a new workspace's "Owners and admins" email destination receives. */
export const DEFAULT_EMAIL_EVENTS: NotificationEventType[] = [
  'release.auto_reverted',
  'release.auto_revert_suppressed',
  'usage.warning',
];

export const DEFAULT_EMAIL_DESTINATION_NAME = 'Owners and admins';

/** A destination shows as failing from this many failed attempts in a row. */
export const FAILING_AFTER_FAILURES = 3;

export const MAX_DESTINATION_NAME_LENGTH = 80;

const EVENT_TYPES = new Set<string>(NOTIFICATION_EVENTS.map((event) => event.type));

export function isNotificationEventType(value: unknown): value is NotificationEventType {
  return typeof value === 'string' && EVENT_TYPES.has(value);
}

export function notificationEventLabel(type: string): string {
  if (type === TEST_EVENT_TYPE) return 'Test';
  return NOTIFICATION_EVENTS.find((event) => event.type === type)?.label ?? type;
}

export type NotificationActor = {
  type: 'user' | 'api_key' | 'system';
  label: string;
};

export type AutoRevertHealth = {
  rollbacks: number;
  attempts: number;
  measuredRatePercent: number;
  ratePercent: number;
  minSample: number;
  windowHours: number;
};

export type NotificationBundle = {
  id: string;
  version: string;
  runtimeVersion: string | null;
  size: number;
  strategy: string;
  createdAt: string;
};

export type NotificationUsage = {
  threshold: 90 | 100;
  downloadsCount: number;
  limit: number;
  periodStart: string;
};

/** Per-type fields of `data`, as passed to emitNotification. */
export type NotificationEventFields =
  | {
      type: 'release.published';
      data: {
        release: ReleaseSummary;
        previousRelease: ReleaseSummary | null;
        replacedRelease?: ReleaseSummary;
      };
    }
  | {
      type: 'release.rollout_updated';
      data: { release: ReleaseSummary; previousPercent: number };
    }
  | {
      type: 'release.reverted';
      data: { release: ReleaseSummary; currentRelease: ReleaseSummary | null };
    }
  | {
      type: 'release.auto_reverted';
      data: {
        release: ReleaseSummary;
        currentRelease: ReleaseSummary | null;
        health: AutoRevertHealth;
      };
    }
  | {
      type: 'release.auto_revert_suppressed';
      data: { release: ReleaseSummary; health: AutoRevertHealth };
    }
  | { type: 'bundle.uploaded'; data: { bundle: NotificationBundle } }
  | { type: 'usage.warning'; data: { usage: NotificationUsage } }
  | { type: typeof TEST_EVENT_TYPE; data: { message: string } };

/** Fields every payload carries, filled in by emitNotification. */
export type NotificationContext = {
  organization: { id: string; name: string };
  /** Null for workspace-wide events (usage, tests). */
  app: { id: string; slug: string } | null;
  /** Who made the change; null when nobody did (usage, tests). */
  actor: NotificationActor | null;
  /** Where to look in the dashboard. */
  url: string;
};

/** The JSON body of a notification: what webhooks receive and every format renders. */
export type NotificationPayload = {
  [Fields in NotificationEventFields as Fields['type']]: {
    type: Fields['type'];
    timestamp: string;
    data: NotificationContext & Fields['data'];
  };
}[NotificationEventFields['type']];
