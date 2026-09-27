import { z } from 'zod';

import { db } from '@/lib/db';

import { getPushLimits } from './limits';

const shortText = (max: number) => z.string().trim().min(1).max(max);
const topic = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const registerDeviceSchema = z
  .object({
    token: z.string().trim().min(1).max(4096),
    platform: z.enum(['ios', 'android']),
    provider: z.enum(['apns', 'fcm']).optional(),
    environment: z.enum(['production', 'sandbox']).optional(),
    externalUserId: shortText(128).nullable().optional(),
    topics: z.array(topic).max(20).optional(),
    channel: shortText(64).nullable().optional(),
    runtimeVersion: shortText(64).nullable().optional(),
    bundleVersion: shortText(64).nullable().optional(),
    appVersion: shortText(64).nullable().optional(),
    locale: shortText(16).nullable().optional(),
  })
  .superRefine((value, context) => {
    const provider = value.provider ?? (value.platform === 'ios' ? 'apns' : 'fcm');
    if (provider === 'apns' && !/^[0-9a-fA-F]{64,200}$/.test(value.token)) {
      context.addIssue({ code: 'custom', path: ['token'], message: 'Invalid APNs device token' });
    }
    if (provider === 'fcm' && !/^[A-Za-z0-9:_\-.]+$/.test(value.token)) {
      context.addIssue({
        code: 'custom',
        path: ['token'],
        message: 'Invalid FCM registration token',
      });
    }
    if (provider === 'apns' && value.platform !== 'ios') {
      context.addIssue({ code: 'custom', path: ['provider'], message: 'APNs tokens are iOS only' });
    }
  });

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export type RegisterDeviceResult =
  | { accepted: true; deviceId: string; created: boolean }
  | { accepted: false; reason: 'device_limit' };

export type PushApp = {
  id: string;
  organizationId: string;
  planKey: 'free' | 'starter' | 'pro' | 'enterprise';
};

export async function findPushApp(appId: string): Promise<PushApp | null> {
  if (!/^[0-9a-f-]{36}$/i.test(appId)) return null;
  const app = await db.app.findUnique({
    where: { id: appId },
    select: { id: true, organizationId: true, organization: { select: { planKey: true } } },
  });
  if (!app) return null;
  return { id: app.id, organizationId: app.organizationId, planKey: app.organization.planKey };
}

export async function registerDevice(
  app: PushApp,
  input: RegisterDeviceInput,
  now: Date = new Date(),
): Promise<RegisterDeviceResult> {
  const provider = input.provider ?? (input.platform === 'ios' ? 'apns' : 'fcm');
  const token = provider === 'apns' ? input.token.toLowerCase() : input.token;
  const fields = {
    platform: input.platform,
    provider,
    environment: input.environment ?? 'production',
    externalUserId: input.externalUserId ?? null,
    topics: input.topics ?? [],
    channel: input.channel ?? null,
    runtimeVersion: input.runtimeVersion ?? null,
    bundleVersion: input.bundleVersion ?? null,
    appVersion: input.appVersion ?? null,
    locale: input.locale ?? null,
    lastSeenAt: now,
  } as const;

  const existing = await db.pushDevice.findUnique({
    where: { appId_token: { appId: app.id, token } },
    select: { id: true },
  });
  if (existing) {
    await db.pushDevice.update({ where: { id: existing.id }, data: fields });
    return { accepted: true, deviceId: existing.id, created: false };
  }

  // Business limits never break the customer's app: over the cap, new devices are
  // simply not stored and the helper is told why.
  const registered = await db.pushDevice.count({
    where: { app: { organizationId: app.organizationId } },
  });
  if (registered >= getPushLimits(app.planKey).devices) {
    return { accepted: false, reason: 'device_limit' };
  }

  const device = await db.pushDevice.upsert({
    where: { appId_token: { appId: app.id, token } },
    create: { appId: app.id, token, ...fields },
    update: fields,
    select: { id: true },
  });
  return { accepted: true, deviceId: device.id, created: true };
}

export async function unregisterDevice(appId: string, token: string): Promise<void> {
  const normalized = /^[0-9a-fA-F]{64,200}$/.test(token) ? token.toLowerCase() : token;
  await db.pushDevice.deleteMany({ where: { appId, token: normalized } });
}

export const topicsSchema = z.object({
  token: z.string().trim().min(1).max(4096),
  add: z.array(topic).max(20).optional(),
  remove: z.array(topic).max(20).optional(),
});

export async function updateDeviceTopics(
  appId: string,
  input: z.infer<typeof topicsSchema>,
): Promise<boolean> {
  const normalized = /^[0-9a-fA-F]{64,200}$/.test(input.token)
    ? input.token.toLowerCase()
    : input.token;
  const device = await db.pushDevice.findUnique({
    where: { appId_token: { appId, token: normalized } },
    select: { id: true, topics: true },
  });
  if (!device) return false;
  const next = new Set(device.topics);
  for (const t of input.add ?? []) next.add(t);
  for (const t of input.remove ?? []) next.delete(t);
  await db.pushDevice.update({
    where: { id: device.id },
    data: { topics: [...next].slice(0, 20), lastSeenAt: new Date() },
  });
  return true;
}
