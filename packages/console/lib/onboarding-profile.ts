import { z } from 'zod';

/**
 * The questionnaire, in order. Every question is a single click and none of
 * them is required: the answers are product research, so they must never stand
 * between a new workspace and its first app. Anything that needs typing, or
 * that asks for a decision the reader cannot make yet, belongs somewhere else.
 */
export const ONBOARDING_QUESTIONS = ['stage', 'updates', 'source'] as const;
export type OnboardingQuestion = (typeof ONBOARDING_QUESTIONS)[number];

export const FIRST_QUESTION = ONBOARDING_QUESTIONS[0];
export const LAST_QUESTION = ONBOARDING_QUESTIONS[ONBOARDING_QUESTIONS.length - 1];

const technologySchema = z.enum([
  'capacitor',
  'react_native',
  'flutter',
  'native',
  'web',
  'not_sure',
]);

// Only `appStage`, `otaProvider` and `source` are still asked. The rest are
// answers from earlier versions of the questionnaire, kept because the parse is
// strict: dropping a field would make every row that still carries it fail and
// read back as empty, losing the research already collected.
export const onboardingAnswersSchema = z
  .object({
    technology: technologySchema.optional(),
    technologies: z.array(technologySchema).max(6).optional(),
    framework: z.enum(['react', 'vue', 'angular', 'svelte', 'other', 'not_sure']).optional(),
    appStage: z.enum(['live', 'testing', 'building', 'exploring']).optional(),
    otaProvider: z
      .enum(['none', 'appflow', 'capgo', 'capawesome', 'custom', 'other', 'not_sure'])
      .optional(),
    otherProvider: z.string().trim().max(120).optional(),
    goal: z.enum(['start', 'migrate', 'cost', 'explore']).optional(),
    activeUsers: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
    updatesPerMonth: z.number().int().min(0).max(1_000).nullable().optional(),
    source: z
      .enum(['search', 'ai', 'community', 'recommendation', 'launch_site', 'ad', 'other'])
      .optional(),
    sourceDetail: z.string().trim().max(120).optional(),
  })
  .strict();

export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;

export type OnboardingProfile = {
  answers: OnboardingAnswers;
  step: OnboardingQuestion;
  completedAt: string | null;
  skippedAt: string | null;
};

/**
 * The question to open on. Rows written by earlier versions of the flow can
 * carry a step that no longer exists (`app`, `audience`, `plans`), so anything
 * unrecognised restarts at the first question instead of leaving a blank card.
 */
export function resumeOnboardingStep(saved: string): OnboardingQuestion {
  return ONBOARDING_QUESTIONS.find((question) => question === saved) ?? FIRST_QUESTION;
}

export function shouldShowOnboarding(input: {
  appCount: number;
  role: string;
  profile: Pick<OnboardingProfile, 'completedAt' | 'skippedAt'> | null;
}) {
  return (
    input.appCount === 0 &&
    input.role === 'owner' &&
    !input.profile?.completedAt &&
    !input.profile?.skippedAt
  );
}

export function appIdentifierError(value: string): string | null {
  const slug = value.trim();
  if (!slug) return 'Give your app an identifier, such as my-app.';
  if (!/^[A-Za-z0-9._-]{3,120}$/.test(slug)) {
    return 'Use 3–120 letters, numbers, dots, underscores, or hyphens. Spaces are not supported.';
  }
  return null;
}

export const onboardingRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('save'),
      answers: onboardingAnswersSchema,
      step: z.enum(ONBOARDING_QUESTIONS),
    })
    .strict(),
  z
    .object({
      action: z.literal('complete'),
      answers: onboardingAnswersSchema,
    })
    .strict(),
  z.object({ action: z.literal('skip'), answers: onboardingAnswersSchema.optional() }).strict(),
]);

export type OnboardingRequest = z.infer<typeof onboardingRequestSchema>;
