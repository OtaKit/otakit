import type { OrganizationOnboarding, Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { recordAuditLog, sessionActor } from '@/lib/audit-log';
import type { SessionContext } from '@/lib/session';
import {
  ONBOARDING_STEPS,
  appIdentifierError,
  isUnsupportedTechnology,
  onboardingAnswersSchema,
  onboardingStepError,
  resumeOnboardingStep,
  type OnboardingProfile,
  type OnboardingRequest,
} from '@/lib/onboarding-profile';
import { OtaKitServiceError } from './errors';

type ProfileRow = OrganizationOnboarding & { connectedApp: { id: string; slug: string } | null };
const include = { connectedApp: { select: { id: true, slug: true } } } as const;

function serialize(row: ProfileRow): OnboardingProfile {
  const parsed = onboardingAnswersSchema.safeParse(row.answers);
  const answers = parsed.success ? parsed.data : {};
  const step = ONBOARDING_STEPS.find((step) => step === row.step) ?? 'app';
  return {
    answers,
    step: resumeOnboardingStep(answers, step),
    completedAt: row.completedAt?.toISOString() ?? null,
    skippedAt: row.skippedAt?.toISOString() ?? null,
    connectedApp: row.connectedApp,
  };
}

export async function getOnboardingProfile(
  organizationId: string,
): Promise<OnboardingProfile | null> {
  const row = await db.organizationOnboarding.findUnique({ where: { organizationId }, include });
  return row ? serialize(row) : null;
}

export async function updateOnboardingProfile(
  ctx: SessionContext,
  input: OnboardingRequest,
): Promise<OnboardingProfile & { appCreated: boolean }> {
  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    throw new OtaKitServiceError(
      'INSUFFICIENT_ROLE',
      'Only workspace owners and admins can change onboarding.',
      403,
    );
  }
  if (input.action === 'complete') {
    const unsupported = isUnsupportedTechnology(input.answers.technology);
    for (const step of unsupported ? (['app'] as const) : ONBOARDING_STEPS) {
      const error = onboardingStepError(input.answers, step);
      if (error) throw new OtaKitServiceError('INVALID_INPUT', error, 400);
    }
    if (!unsupported) {
      const error = appIdentifierError(input.slug ?? '');
      if (error) throw new OtaKitServiceError('INVALID_INPUT', error, 400);
    } else if (input.slug) {
      throw new OtaKitServiceError(
        'INVALID_INPUT',
        'OtaKit currently supports Capacitor apps. This stack cannot be connected.',
        400,
      );
    }
  }

  const result = await db.$transaction(async (tx) => {
    // Serialize saves/completion for this workspace. Retried or concurrent finish
    // requests must return the same app instead of creating duplicate records.
    await tx.$executeRaw`INSERT INTO "OrganizationOnboarding" ("organizationId", "updatedAt")
      VALUES (${ctx.organizationId}, NOW()) ON CONFLICT ("organizationId") DO NOTHING`;
    await tx.$queryRaw`SELECT "organizationId" FROM "OrganizationOnboarding"
      WHERE "organizationId" = ${ctx.organizationId} FOR UPDATE`;
    const existing = await tx.organizationOnboarding.findUniqueOrThrow({
      where: { organizationId: ctx.organizationId },
      include,
    });
    if (existing.connectedAppId) return { row: existing, createdApp: false, changed: false };

    let createdApp = false;
    const data: Prisma.OrganizationOnboardingUpdateInput = {};
    if (input.action === 'skip') {
      data.skippedAt = existing.skippedAt ?? new Date();
    } else {
      data.answers = input.answers;
      data.skippedAt = null;
      if (input.action === 'save') {
        data.step = resumeOnboardingStep(input.answers, input.step);
        data.completedAt = null;
      } else {
        data.completedAt = existing.completedAt ?? new Date();
        data.step = 'connect';
        if (!isUnsupportedTechnology(input.answers.technology)) {
          const slug = input.slug!.trim();
          // Also tolerate registration through the CLI while this screen is open.
          const inserted = await tx.app.createMany({
            data: [{ organizationId: ctx.organizationId, slug }],
            skipDuplicates: true,
          });
          createdApp = inserted.count > 0;
          const app = await tx.app.findUniqueOrThrow({
            where: { organizationId_slug: { organizationId: ctx.organizationId, slug } },
            select: { id: true },
          });
          data.connectedApp = { connect: { id: app.id } };
        }
      }
    }
    const row = await tx.organizationOnboarding.update({
      where: { organizationId: ctx.organizationId },
      data,
      include,
    });
    return { row, createdApp, changed: true };
  });

  if (result.createdApp && result.row.connectedApp) {
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actor: sessionActor(ctx),
      action: 'app.created',
      targetType: 'app',
      targetId: result.row.connectedApp.id,
      metadata: { slug: result.row.connectedApp.slug, source: 'onboarding' },
    });
  }
  if (result.changed) {
    await recordAuditLog({
      organizationId: ctx.organizationId,
      actor: sessionActor(ctx),
      action:
        input.action === 'skip'
          ? 'onboarding.skipped'
          : input.action === 'complete'
            ? 'onboarding.completed'
            : 'onboarding.updated',
      targetType: 'organization',
      targetId: ctx.organizationId,
      metadata: { step: result.row.step },
    });
  }
  return { ...serialize(result.row), appCreated: result.createdApp };
}
