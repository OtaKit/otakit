import { describe, expect, it } from 'vitest';

import {
  appIdentifierError,
  FIRST_QUESTION,
  LAST_QUESTION,
  ONBOARDING_QUESTIONS,
  onboardingAnswersSchema,
  onboardingRequestSchema,
  resumeOnboardingStep,
  shouldShowOnboarding,
  type OnboardingAnswers,
} from './onboarding-profile';
import { isValidAppSlug } from './validation';

const answers: OnboardingAnswers = {
  appStage: 'testing',
  otaProvider: 'none',
  source: 'search',
};

describe('guided onboarding validation', () => {
  it('asks three single-click questions, ending on the last one', () => {
    expect(ONBOARDING_QUESTIONS).toEqual(['stage', 'updates', 'source']);
    expect(FIRST_QUESTION).toBe('stage');
    expect(LAST_QUESTION).toBe('source');
  });

  it('resumes the saved question', () => {
    for (const question of ONBOARDING_QUESTIONS) {
      expect(resumeOnboardingStep(question)).toBe(question);
    }
  });

  it('restarts rows saved on a question that no longer exists', () => {
    // Written by earlier versions of the flow; none of these may leave the card
    // blank, so they fall back to the first question.
    for (const retired of ['app', 'audience', 'plans', '', 'nonsense']) {
      expect(resumeOnboardingStep(retired)).toBe(FIRST_QUESTION);
    }
  });

  it('still parses answers collected by earlier versions of the questionnaire', () => {
    // The parse is strict, so a retired field must stay in the schema: dropping
    // one would make every row that carries it read back as empty.
    for (const legacy of [
      { technology: 'capacitor' },
      { technologies: ['capacitor', 'flutter'] },
      { framework: 'react' },
      { goal: 'migrate' },
      { activeUsers: 1000, updatesPerMonth: 4 },
      { otherProvider: 'Some provider', sourceDetail: 'A newsletter' },
    ]) {
      expect(onboardingAnswersSchema.safeParse(legacy).success).toBe(true);
    }
  });

  it('rejects impossible values and arbitrary fields', () => {
    for (const activeUsers of [-1, 1.5, NaN, Infinity, 1_000_000_001, '1000']) {
      expect(onboardingAnswersSchema.safeParse({ activeUsers }).success).toBe(false);
    }
    expect(onboardingAnswersSchema.safeParse({ technologies: ['nope'] }).success).toBe(false);
    expect(onboardingAnswersSchema.safeParse({ appStage: 'live', unknown: true }).success).toBe(
      false,
    );
  });

  it('accepts a save only on a question that is still asked', () => {
    for (const step of ONBOARDING_QUESTIONS) {
      expect(onboardingRequestSchema.safeParse({ action: 'save', answers, step }).success).toBe(
        true,
      );
    }
    for (const retired of ['app', 'audience', 'plans']) {
      expect(
        onboardingRequestSchema.safeParse({ action: 'save', answers, step: retired }).success,
      ).toBe(false);
    }
    expect(
      onboardingRequestSchema.safeParse({
        action: 'save',
        answers,
        step: 'stage',
        organizationId: 'another-org',
      }).success,
    ).toBe(false);
  });

  it('finishes and skips with no answers at all, because none is required', () => {
    expect(onboardingRequestSchema.safeParse({ action: 'complete', answers: {} }).success).toBe(
      true,
    );
    expect(onboardingRequestSchema.safeParse({ action: 'skip' }).success).toBe(true);
    expect(onboardingRequestSchema.safeParse({ action: 'skip', answers }).success).toBe(true);
    expect(
      onboardingRequestSchema.safeParse({ action: 'complete', answers, slug: 'my-app' }).success,
    ).toBe(false);
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
