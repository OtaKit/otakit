import type { OrganizationOnboarding, Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { recordAuditLog, sessionActor } from '@/lib/audit-log';
import type { SessionContext } from '@/lib/session';
import {
  FIRST_QUESTION,
  LAST_QUESTION,
  onboardingAnswersSchema,
  resumeOnboardingStep,
  type OnboardingProfile,
  type OnboardingRequest,
} from '@/lib/onboarding-profile';
import { OtaKitServiceError } from './errors';

function serialize(row: OrganizationOnboarding): OnboardingProfile {
  const parsed = onboardingAnswersSchema.safeParse(row.answers);
  const answers = parsed.success ? parsed.data : {};
  return {
    answers,
    // A finished questionnaire opens on its last question, so coming back to
    // /onboarding shows the answers instead of restarting the flow.
    step: row.completedAt ? LAST_QUESTION : resumeOnboardingStep(row.step),
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
  // No question is required, so there is nothing to validate before finishing:
  // an unanswered questionnaire is a complete one.
  const result = await db.$transaction(async (tx) => {
    // A delayed save from another tab must not reopen completed onboarding.
    // `step` is named explicitly because the column default is still 'app', a
    // question that no longer exists: a row created by a skip is never updated
    // again, so letting the default stand would store a retired step forever.
    await tx.$executeRaw`INSERT INTO "OrganizationOnboarding" ("organizationId", "step", "updatedAt")
      VALUES (${ctx.organizationId}, ${FIRST_QUESTION}, NOW()) ON CONFLICT ("organizationId") DO NOTHING`;
    await tx.$queryRaw`SELECT "organizationId" FROM "OrganizationOnboarding"
      WHERE "organizationId" = ${ctx.organizationId} FOR UPDATE`;
    const existing = await tx.organizationOnboarding.findUniqueOrThrow({
      where: { organizationId: ctx.organizationId },
    });
    if (existing.completedAt) return { row: existing, changed: false };

    const data: Prisma.OrganizationOnboardingUpdateInput = {};
    if (input.action === 'skip') {
      data.skippedAt = existing.skippedAt ?? new Date();
      if (input.answers) data.answers = input.answers;
    } else {
      data.answers = input.answers;
      if (input.action === 'save') {
        data.step = input.step;
        // An explicit return can resume a skipped questionnaire, but saving a
        // draft must not make dashboard visits mandatory again.
      } else {
        data.completedAt = new Date();
        data.skippedAt = null;
        data.step = LAST_QUESTION;
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
