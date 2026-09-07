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
};

describe('guided onboarding validation', () => {
  it('resumes the saved question and corrects incomplete earlier answers', () => {
    expect(resumeOnboardingStep({}, 'audience')).toBe('app');
    expect(resumeOnboardingStep({ ...answers, otaProvider: undefined }, 'audience')).toBe(
      'updates',
    );
    expect(resumeOnboardingStep(answers, 'audience')).toBe('audience');
    expect(resumeOnboardingStep(answers, 'updates')).toBe('updates');
  });

  it('allows a known unsupported platform to finish without a pricing survey', () => {
    expect(onboardingStepError({ technology: 'react_native' }, 'app')).toBeNull();
    expect(resumeOnboardingStep({ technology: 'flutter' }, 'audience')).toBe('app');
  });

  it('distinguishes not answered, unknown, and a pre-launch audience of zero', () => {
    expect(onboardingStepError({}, 'audience')).toBeNull();
    expect(
      onboardingStepError({ activeUsers: null, updatesPerMonth: null }, 'audience'),
    ).toBeNull();
    expect(onboardingStepError({ activeUsers: 0, updatesPerMonth: 2 }, 'audience')).toBeNull();
    expect(estimateMonthlyDownloads({ activeUsers: null, updatesPerMonth: 4 })).toBeNull();
    expect(estimateMonthlyDownloads({ activeUsers: 0, updatesPerMonth: 4 })).toBe(0);
    expect(estimateMonthlyDownloads(answers)).toBe(4000);
  });

  it('allows blank audience estimates but reports invalid entered numbers', () => {
    for (const activeUsers of [-1, 1.5, Infinity, 1_000_000_001]) {
      expect(onboardingStepError({ activeUsers }, 'audience')).toContain('Monthly active users');
    }
    for (const updatesPerMonth of [-1, 1.5, 1001]) {
      expect(onboardingStepError({ updatesPerMonth }, 'audience')).toContain('Monthly OTA updates');
    }
    expect(
      onboardingStepError({ activeUsers: 1_000_000_000, updatesPerMonth: 1000 }, 'audience'),
    ).toBeNull();
  });

  it('rejects impossible usage, arbitrary fields, and attempts to skip completion', () => {
    for (const activeUsers of [-1, 1.5, NaN, Infinity, 1_000_000_001, '1000']) {
      expect(onboardingAnswersSchema.safeParse({ activeUsers }).success).toBe(false);
    }
    expect(
      onboardingRequestSchema.safeParse({
        action: 'save',
        answers,
        step: 'audience',
        organizationId: 'another-org',
      }).success,
    ).toBe(false);
    expect(
      onboardingAnswersSchema.safeParse({ technology: 'capacitor', unknown: true }).success,
    ).toBe(false);
    expect(
      onboardingRequestSchema.safeParse({ action: 'save', step: 'plans', answers }).success,
    ).toBe(false);
    expect(
      onboardingRequestSchema.safeParse({ action: 'complete', answers, slug: 'my-app' }).success,
    ).toBe(false);
    expect(onboardingRequestSchema.safeParse({ action: 'complete', answers }).success).toBe(true);
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
