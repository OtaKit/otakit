import { Prisma, type PushCampaignStatus } from '@prisma/client';

import { recordAuditLog, type AuditActor } from '@/lib/audit-log';
import { db } from '@/lib/db';
import { OtaKitServiceError } from '@/lib/services/errors';

import { audienceSchema, audienceWhere, countAudience, type Audience } from './audience';
import { getPushLimits, pushPeriodStart } from './limits';
import { assertPayloadFits, pushPayloadSchema, type PushPayload } from './payload';

export const BATCH_SIZE = 500;

export type CampaignSummary = {
  id: string;
  status: PushCampaignStatus;
  payload: PushPayload;
  audience: Audience;
  targeted: number;
  accepted: number;
  failed: number;
  invalidRemoved: number;
  errorSummary: Record<string, number> | null;
  failureReason: string | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
};

type CampaignRow = Prisma.PushCampaignGetPayload<Record<string, never>>;

export function toCampaignSummary(row: CampaignRow): CampaignSummary {
  return {
    id: row.id,
    status: row.status,
    payload: row.payload as PushPayload,
    audience: row.audience as Audience,
    targeted: row.targeted,
    accepted: row.accepted,
    failed: row.failed,
    invalidRemoved: row.invalidRemoved,
    errorSummary: (row.errorSummary as Record<string, number> | null) ?? null,
    failureReason: row.failureReason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function invalidInput(message: string): OtaKitServiceError {
  return new OtaKitServiceError('INVALID_INPUT', message, 400);
}

export function parseCampaignInput(input: { payload: unknown; audience: unknown }): {
  payload: PushPayload;
  audience: Audience;
} {
  const payload = pushPayloadSchema.safeParse(input.payload);
  if (!payload.success) {
    throw invalidInput(payload.error.issues.map((issue) => issue.message).join('; '));
  }
  const audience = audienceSchema.safeParse(input.audience ?? {});
  if (!audience.success) {
    throw invalidInput(audience.error.issues.map((issue) => issue.message).join('; '));
  }
  try {
    assertPayloadFits(payload.data);
  } catch (error) {
    throw invalidInput(error instanceof Error ? error.message : 'Notification is too large');
  }
  return { payload: payload.data, audience: audience.data };
}

export async function previewCampaign(input: {
  appId: string;
  payload: unknown;
  audience: unknown;
}) {
  const { payload, audience } = parseCampaignInput(input);
  const counts = await countAudience(input.appId, audience);
  const credentials = await db.pushCredential.findMany({
    where: { appId: input.appId },
    select: { provider: true },
  });
  const configured = new Set(credentials.map((credential) => credential.provider));
  const warnings: string[] = [];
  if (counts.ios > 0 && !configured.has('apns')) {
    warnings.push(`${counts.ios} iOS devices will be skipped: no APNs key uploaded.`);
  }
  if (counts.android > 0 && !configured.has('fcm')) {
    warnings.push(
      `${counts.android} Android devices will be skipped: no Firebase service account.`,
    );
  }
  return { payload, audience, audienceCount: counts, warnings };
}

export async function createCampaign(input: {
  organizationId: string;
  appId: string;
  actor: AuditActor;
  payload: unknown;
  audience: unknown;
  expectedAudience?: number;
  idempotencyKey?: string;
}): Promise<CampaignSummary> {
  const { payload, audience } = parseCampaignInput(input);
  const idempotencyKey = input.idempotencyKey?.trim().slice(0, 128) || null;

  if (idempotencyKey) {
    const existing = await db.pushCampaign.findUnique({
      where: { appId_idempotencyKey: { appId: input.appId, idempotencyKey } },
    });
    if (existing) return toCampaignSummary(existing);
  }

  const [organization, credentials] = await Promise.all([
    db.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
      select: { planKey: true, usagePeriodStart: true },
    }),
    db.pushCredential.findMany({ where: { appId: input.appId }, select: { provider: true } }),
  ]);
  const providers = new Set(credentials.map((credential) => credential.provider));
  if (providers.size === 0) {
    throw new OtaKitServiceError(
      'PUSH_NOT_CONFIGURED',
      'Upload an APNs key or a Firebase service account before sending.',
      409,
    );
  }

  // Only devices we can reach count against the audience.
  const reachablePlatforms = [
    ...(providers.has('apns') ? (['ios'] as const) : []),
    ...(providers.has('fcm') ? (['android'] as const) : []),
  ];
  const where: Prisma.PushDeviceWhereInput = {
    AND: [audienceWhere(input.appId, audience), { platform: { in: [...reachablePlatforms] } }],
  };

  const periodStart = pushPeriodStart(organization.usagePeriodStart);
  const usage = await db.pushUsage.findUnique({
    where: { organizationId_periodStart: { organizationId: input.organizationId, periodStart } },
    select: { sends: true },
  });
  const limit = getPushLimits(organization.planKey).sendsPerMonth;

  const campaign = await db.$transaction(
    async (tx) => {
      const devices = await tx.pushDevice.findMany({
        where,
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (devices.length === 0) {
        throw invalidInput('No devices match this audience.');
      }
      if (input.expectedAudience !== undefined && input.expectedAudience !== devices.length) {
        throw new OtaKitServiceError(
          'INVALID_INPUT',
          `The audience changed: expected ${input.expectedAudience} devices, found ${devices.length}.`,
          409,
          'Preview the campaign again, then send.',
        );
      }
      if ((usage?.sends ?? 0) + devices.length > limit) {
        throw new OtaKitServiceError(
          'PUSH_LIMIT_REACHED',
          `This would exceed your plan's ${limit.toLocaleString('en-US')} notifications this month.`,
          402,
          'Upgrade your plan or send to a smaller audience.',
        );
      }

      const created = await tx.pushCampaign.create({
        data: {
          appId: input.appId,
          organizationId: input.organizationId,
          payload: payload as Prisma.InputJsonValue,
          audience: audience as Prisma.InputJsonValue,
          targeted: devices.length,
          idempotencyKey,
          createdBy: input.actor.actorLabel,
        },
      });
      const batches = [];
      for (let i = 0; i < devices.length; i += BATCH_SIZE) {
        batches.push({
          campaignId: created.id,
          deviceIds: devices.slice(i, i + BATCH_SIZE).map((device) => device.id),
        });
      }
      await tx.pushSendBatch.createMany({ data: batches });
      return created;
    },
    { maxWait: 10_000, timeout: 60_000 },
  );

  await recordAuditLog({
    organizationId: input.organizationId,
    actor: input.actor,
    action: 'push_campaign.created',
    targetType: 'push_campaign',
    targetId: campaign.id,
    metadata: { appId: input.appId, targeted: campaign.targeted, title: payload.title },
  });
  return toCampaignSummary(campaign);
}

export async function listCampaigns(appId: string, limit = 50): Promise<CampaignSummary[]> {
  const rows = await db.pushCampaign.findMany({
    where: { appId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map(toCampaignSummary);
}

export async function getCampaign(appId: string, campaignId: string): Promise<CampaignSummary> {
  const row = await db.pushCampaign.findFirst({ where: { id: campaignId, appId } });
  if (!row) {
    throw new OtaKitServiceError('PUSH_CAMPAIGN_NOT_FOUND', 'Campaign not found', 404);
  }
  return toCampaignSummary(row);
}

export async function cancelCampaign(input: {
  organizationId: string;
  appId: string;
  campaignId: string;
  actor: AuditActor;
}): Promise<CampaignSummary> {
  const row = await db.pushCampaign.findFirst({
    where: { id: input.campaignId, appId: input.appId },
  });
  if (!row) throw new OtaKitServiceError('PUSH_CAMPAIGN_NOT_FOUND', 'Campaign not found', 404);
  if (row.status !== 'queued' && row.status !== 'sending') return toCampaignSummary(row);

  const updated = await db.$transaction(async (tx) => {
    await tx.pushSendBatch.updateMany({
      where: { campaignId: row.id, status: 'pending' },
      data: { status: 'done' },
    });
    return tx.pushCampaign.update({
      where: { id: row.id },
      data: { status: 'canceled', completedAt: new Date() },
    });
  });
  await recordAuditLog({
    organizationId: input.organizationId,
    actor: input.actor,
    action: 'push_campaign.canceled',
    targetType: 'push_campaign',
    targetId: row.id,
    metadata: { appId: input.appId },
  });
  return toCampaignSummary(updated);
}
