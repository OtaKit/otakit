import { audienceSchema, audienceWhere, countAudience, type Audience } from './audience';
import { Prisma, type PushCampaignStatus, pushDb } from './db';
import { invalidInput, PushError } from './errors';
import type { PushHost } from './host';
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
  const credentials = await pushDb().pushCredential.findMany({
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

/**
 * Queues a campaign. `created` is false when the idempotency key matched an earlier
 * campaign, which is returned unchanged.
 */
export async function createCampaign(
  host: PushHost,
  input: {
    organizationId: string;
    appId: string;
    actorLabel: string;
    payload: unknown;
    audience: unknown;
    expectedAudience?: number;
    idempotencyKey?: string;
  },
): Promise<{ campaign: CampaignSummary; created: boolean }> {
  const db = pushDb();
  const { payload, audience } = parseCampaignInput(input);
  const idempotencyKey = input.idempotencyKey?.trim().slice(0, 128) || null;

  if (idempotencyKey) {
    const existing = await db.pushCampaign.findUnique({
      where: { appId_idempotencyKey: { appId: input.appId, idempotencyKey } },
    });
    if (existing) return { campaign: toCampaignSummary(existing), created: false };
  }

  const [workspace, credentials] = await Promise.all([
    host.getWorkspace(input.organizationId),
    db.pushCredential.findMany({ where: { appId: input.appId }, select: { provider: true } }),
  ]);
  const providers = new Set(credentials.map((credential) => credential.provider));
  if (providers.size === 0) {
    throw new PushError(
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

  const periodStart = pushPeriodStart(workspace.periodStart);
  const usage = await db.pushUsage.findUnique({
    where: { organizationId_periodStart: { organizationId: input.organizationId, periodStart } },
    select: { sends: true },
  });
  const limit = getPushLimits(workspace.plan).sendsPerMonth;

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
        throw new PushError(
          'INVALID_INPUT',
          `The audience changed: expected ${input.expectedAudience} devices, found ${devices.length}.`,
          409,
          'Preview the campaign again, then send.',
        );
      }
      if ((usage?.sends ?? 0) + devices.length > limit) {
        throw new PushError(
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
          createdBy: input.actorLabel,
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

  return { campaign: toCampaignSummary(campaign), created: true };
}

export async function listCampaigns(appId: string, limit = 50): Promise<CampaignSummary[]> {
  const rows = await pushDb().pushCampaign.findMany({
    where: { appId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map(toCampaignSummary);
}

export async function getCampaign(appId: string, campaignId: string): Promise<CampaignSummary> {
  const row = await pushDb().pushCampaign.findFirst({ where: { id: campaignId, appId } });
  if (!row) throw new PushError('PUSH_CAMPAIGN_NOT_FOUND', 'Campaign not found', 404);
  return toCampaignSummary(row);
}

/** `canceled` is false when the campaign had already finished. */
export async function cancelCampaign(input: {
  appId: string;
  campaignId: string;
}): Promise<{ campaign: CampaignSummary; canceled: boolean }> {
  const db = pushDb();
  const row = await db.pushCampaign.findFirst({
    where: { id: input.campaignId, appId: input.appId },
  });
  if (!row) throw new PushError('PUSH_CAMPAIGN_NOT_FOUND', 'Campaign not found', 404);
  if (row.status !== 'queued' && row.status !== 'sending') {
    return { campaign: toCampaignSummary(row), canceled: false };
  }

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
  return { campaign: toCampaignSummary(updated), canceled: true };
}
