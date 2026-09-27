import { z } from 'zod';

import { APNS_MAX_PAYLOAD_BYTES } from './apns';
import type { FcmMessage } from './fcm';

const RESERVED_DATA_KEYS = new Set(['aps', 'from', 'notification', 'message_type', 'collapse_key']);

export const pushPayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(1000),
    url: z
      .string()
      .trim()
      .max(512)
      .refine((value) => value.startsWith('/') || /^https:\/\//i.test(value), {
        message: 'url must be a path like /inbox or an https:// link',
      })
      .optional(),
    data: z
      .record(z.string().regex(/^[A-Za-z0-9_]{1,40}$/), z.string().max(500))
      .refine((value) => Object.keys(value).length <= 20, { message: 'At most 20 data keys' })
      .optional(),
    sound: z.boolean().optional(),
    badge: z.number().int().min(0).max(9999).optional(),
    ttlSeconds: z.number().int().min(60).max(2_419_200).optional(),
  })
  .superRefine((value, context) => {
    for (const key of Object.keys(value.data ?? {})) {
      if (RESERVED_DATA_KEYS.has(key) || key === 'url' || /^(google|gcm)/i.test(key)) {
        context.addIssue({ code: 'custom', path: ['data', key], message: `"${key}" is reserved` });
      }
    }
  });

export type PushPayload = z.infer<typeof pushPayloadSchema>;

export const DEFAULT_TTL_SECONDS = 86_400;

export function buildApnsPayload(payload: PushPayload): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    alert: { title: payload.title, body: payload.body },
  };
  if (payload.sound !== false) aps.sound = 'default';
  if (payload.badge !== undefined) aps.badge = payload.badge;
  return {
    aps,
    ...(payload.data ?? {}),
    ...(payload.url ? { url: payload.url } : {}),
  };
}

export function buildFcmMessage(payload: PushPayload): FcmMessage {
  const data: Record<string, string> = { ...(payload.data ?? {}) };
  if (payload.url) data.url = payload.url;
  return {
    notification: { title: payload.title, body: payload.body },
    ...(Object.keys(data).length > 0 ? { data } : {}),
    android: { priority: 'HIGH', ttl: `${payload.ttlSeconds ?? DEFAULT_TTL_SECONDS}s` },
  };
}

/** Throws a readable error when the message cannot be sent to iOS. */
export function assertPayloadFits(payload: PushPayload): void {
  const size = Buffer.byteLength(JSON.stringify(buildApnsPayload(payload)));
  if (size > APNS_MAX_PAYLOAD_BYTES) {
    throw new Error(
      `The notification is ${size} bytes; Apple allows ${APNS_MAX_PAYLOAD_BYTES}. Shorten the text or data.`,
    );
  }
}
