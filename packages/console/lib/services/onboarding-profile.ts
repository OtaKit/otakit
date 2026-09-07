import type { OrganizationOnboarding, Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { recordAuditLog, sessionActor } from '@/lib/audit-log';
import type { SessionContext } from '@/lib/session';
import {
  ONBOARDING_QUESTIONS,
  isUnsupportedTechnology,
  onboardingAnswersSchema,
  onboardingStepError,
  resumeOnboardingStep,
  type OnboardingProfile,
  type OnboardingRequest,
} from '@/lib/onboarding-profile';
import { OtaKitServiceError } from './errors';

function serialize(row: OrganizationOnboarding): OnboardingProfile {
  const parsed = onboardingAnswersSchema.safeParse(row.answers);
  const answers = parsed.success ? parsed.data : {};
  const question = ONBOARDING_QUESTIONS.find((step) => step === row.step) ?? 'app';
  return {
    answers,
    step: row.completedAt ? 'plans' : resumeOnboardingStep(answers, question),
    completedAt: row.completedAt?.toISOString() ?? null,
    skippedAt: row.skippedAt?.toISOString() ?? null,
  };
}

export async function getOnboardingProfile(
  organizationId: string,
): Promise<OnboardingProfile | null> {
  const row = await db.organizationOnboarding.findUnique({ where: { organizationId } });
  return row ? serialize(row) : null;
}

export async function updateOnboardingProfile(
  ctx: SessionContext,
  input: OnboardingRequest,
): Promise<OnboardingProfile> {
  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    throw new OtaKitServiceError(
      'INSUFFICIENT_ROLE',
      'Only workspace owners and admins can change onboarding.',
      403,
    );
  }
  if (input.action === 'complete') {
    const questions = isUnsupportedTechnology(input.answers.technology)
      ? (['app'] as const)
      : ONBOARDING_QUESTIONS;
    for (const question of questions) {
      const error = onboardingStepError(input.answers, question);
      if (error) throw new OtaKitServiceError('INVALID_INPUT', error, 400);
    }
  }

  const result = await db.$transaction(async (tx) => {
    // A delayed save from another tab must not reopen completed onboarding.
    await tx.$executeRaw`INSERT INTO "OrganizationOnboarding" ("organizationId", "updatedAt")
      VALUES (${ctx.organizationId}, NOW()) ON CONFLICT ("organizationId") DO NOTHING`;
    await tx.$queryRaw`SELECT "organizationId" FROM "OrganizationOnboarding"
      WHERE "organizationId" = ${ctx.organizationId} FOR UPDATE`;
    const existing = await tx.organizationOnboarding.findUniqueOrThrow({
      where: { organizationId: ctx.organizationId },
    });
    if (existing.completedAt) return { row: existing, changed: false };

    const data: Prisma.OrganizationOnboardingUpdateInput = {};
    if (input.action === 'skip') {
      data.skippedAt = existing.skippedAt ?? new Date();
    } else {
      data.answers = input.answers;
      if (input.action === 'save') {
        data.step = resumeOnboardingStep(input.answers, input.step);
        // An explicit return can resume a skipped questionnaire, but saving a
        // draft must not make dashboard visits mandatory again.
      } else {
        data.completedAt = new Date();
        data.skippedAt = null;
        data.step = 'plans';
      }
    }
    const row = await tx.organizationOnboarding.update({
      where: { organizationId: ctx.organizationId },
      data,
    });
    return { row, changed: true };
  });

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
  return serialize(result.row);
}
