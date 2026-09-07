import { describe, expect, it } from 'vitest';

import {
  appIdentifierError,
  estimateMonthlyDownloads,
  onboardingAnswersSchema,
  onboardingRequestSchema,
  onboardingStepError,
  resumeOnboardingStep,
  shouldShowOnboarding,
  type OnboardingAnswers,
} from './onboarding-profile';
import { isValidAppSlug } from './validation';

const answers: OnboardingAnswers = {
  technology: 'capacitor',
  framework: 'react',
  appStage: 'testing',
  otaProvider: 'none',
  activeUsers: 1000,
  updatesPerMonth: 4,
  selectedPlan: 'free',
};

describe('guided onboarding validation', () => {
  it('resumes at the first unanswered step instead of accepting a jump to connection', () => {
    expect(resumeOnboardingStep({}, 'connect')).toBe('app');
    expect(resumeOnboardingStep({ ...answers, otaProvider: undefined }, 'connect')).toBe('updates');
    expect(resumeOnboardingStep({ ...answers, selectedPlan: undefined }, 'connect')).toBe('plans');
    expect(resumeOnboardingStep(answers, 'connect')).toBe('connect');
    expect(resumeOnboardingStep(answers, 'updates')).toBe('updates');
  });

  it('allows a known unsupported platform to finish without a pricing survey', () => {
    expect(onboardingStepError({ technology: 'react_native' }, 'app')).toBeNull();
    expect(resumeOnboardingStep({ technology: 'flutter' }, 'plans')).toBe('app');
  });

  it('distinguishes not answered, unknown, and a pre-launch audience of zero', () => {
    expect(onboardingStepError({}, 'audience')).toBeTruthy();
    expect(
      onboardingStepError({ activeUsers: null, updatesPerMonth: null }, 'audience'),
    ).toBeNull();
    expect(onboardingStepError({ activeUsers: 0, updatesPerMonth: 2 }, 'audience')).toBeNull();
    expect(estimateMonthlyDownloads({ activeUsers: null, updatesPerMonth: 4 })).toBeNull();
    expect(estimateMonthlyDownloads({ activeUsers: 0, updatesPerMonth: 4 })).toBe(0);
    expect(estimateMonthlyDownloads(answers)).toBe(4000);
  });

  it('rejects impossible usage, arbitrary fields, and invalid billing combinations', () => {
    for (const activeUsers of [-1, 1.5, NaN, Infinity, 1_000_000_001, '1000']) {
      expect(onboardingAnswersSchema.safeParse({ activeUsers }).success).toBe(false);
    }
    expect(
      onboardingRequestSchema.safeParse({
        action: 'save',
        answers,
        step: 'connect',
        organizationId: 'another-org',
      }).success,
    ).toBe(false);
    expect(
      onboardingAnswersSchema.safeParse({ technology: 'capacitor', unknown: true }).success,
    ).toBe(false);
    expect(
      onboardingStepError({ selectedPlan: 'starter', billingInterval: 'year' }, 'plans'),
    ).toBeTruthy();
    expect(onboardingStepError({ selectedPlan: 'pro' }, 'plans')).toBeTruthy();
    expect(
      onboardingStepError({ selectedPlan: 'pro', billingInterval: 'year' }, 'plans'),
    ).toBeNull();
  });

  it.each([
    'my-app',
    'com.example.app',
    'APP_2026',
    'abc',
    'x'.repeat(120),
    'ab',
    'a b',
    '',
    'a/b',
    'x'.repeat(121),
  ])('uses the existing app identifier rules for %s', (slug) => {
    expect(appIdentifierError(slug) === null).toBe(isValidAppSlug(slug));
  });

  it('only intercepts owners with an empty workspace and unfinished onboarding', () => {
    const input = { appCount: 0, role: 'owner', profile: null };
    expect(shouldShowOnboarding(input)).toBe(true);
    expect(shouldShowOnboarding({ ...input, appCount: 1 })).toBe(false);
    expect(shouldShowOnboarding({ ...input, role: 'member' })).toBe(false);
    expect(shouldShowOnboarding({ ...input, role: 'admin' })).toBe(false);
    expect(
      shouldShowOnboarding({ ...input, profile: { skippedAt: '2026-09-07', completedAt: null } }),
    ).toBe(false);
    expect(
      shouldShowOnboarding({ ...input, profile: { skippedAt: null, completedAt: '2026-09-07' } }),
    ).toBe(false);
  });
});
