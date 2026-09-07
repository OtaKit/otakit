import { z } from 'zod';

export const ONBOARDING_QUESTIONS = ['app', 'updates', 'audience'] as const;
export type OnboardingQuestion = (typeof ONBOARDING_QUESTIONS)[number];
export const ONBOARDING_STEPS = [...ONBOARDING_QUESTIONS, 'plans'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const onboardingAnswersSchema = z
  .object({
    technology: z
      .enum(['capacitor', 'react_native', 'flutter', 'native', 'web', 'not_sure'])
      .optional(),
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
  step: OnboardingStep;
  completedAt: string | null;
  skippedAt: string | null;
};

export function isUnsupportedTechnology(technology: OnboardingAnswers['technology']) {
  return technology === 'react_native' || technology === 'flutter' || technology === 'native';
}

export function onboardingStepError(
  answers: OnboardingAnswers,
  step: OnboardingStep,
): string | null {
  if (step === 'app') {
    if (!answers.technology) return 'Choose what your app is built with.';
    if (isUnsupportedTechnology(answers.technology)) return null;
    if (
      (answers.technology === 'capacitor' || answers.technology === 'web') &&
      !answers.framework
    ) {
      return 'Choose your web framework, or select “Not sure”.';
    }
    if (!answers.appStage) return 'Choose where your app is today.';
  }
  if (step === 'updates' && !answers.otaProvider) return 'Choose your current update setup.';
  if (step === 'audience') {
    if (answers.activeUsers === undefined)
      return 'Enter your monthly audience, or choose “Not sure yet”.';
    if (answers.updatesPerMonth === undefined)
      return 'Enter your update frequency, or choose “Not sure yet”.';
  }
  return null;
}

export function resumeOnboardingStep(
  answers: OnboardingAnswers,
  saved: OnboardingQuestion,
): OnboardingQuestion {
  if (isUnsupportedTechnology(answers.technology)) return 'app';
  for (const step of ONBOARDING_QUESTIONS) {
    if (step === saved || onboardingStepError(answers, step)) return step;
  }
  return 'audience';
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

export function estimateMonthlyDownloads(answers: OnboardingAnswers): number | null {
  if (answers.activeUsers == null || answers.updatesPerMonth == null) return null;
  return answers.activeUsers * answers.updatesPerMonth;
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
