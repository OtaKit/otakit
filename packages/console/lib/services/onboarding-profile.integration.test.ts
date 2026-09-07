import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/lib/db';
import type { SessionContext } from '@/lib/session';
import { shouldShowOnboarding, type OnboardingAnswers } from '@/lib/onboarding-profile';
import { getOnboardingProfile, updateOnboardingProfile } from './onboarding-profile';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;
const answers: OnboardingAnswers = {
  technology: 'capacitor',
  framework: 'react',
  appStage: 'live',
  otaProvider: 'capgo',
  activeUsers: 2500,
  updatesPerMonth: 4,
  source: 'search',
};

databaseDescribe('business onboarding (PostgreSQL integration)', () => {
  let ctx: SessionContext;
  beforeEach(async () => {
    const org = await db.organization.create({ data: { name: `Onboarding test ${randomUUID()}` } });
    ctx = {
      organizationId: org.id,
      userId: randomUUID(),
      email: 'onboarding-test@example.test',
      role: 'owner',
    };
  });
  afterEach(async () => {
    await db.organization.delete({ where: { id: ctx.organizationId } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('finishes the business questions without requiring an app or plan selection', async () => {
    const profile = await updateOnboardingProfile(ctx, { action: 'complete', answers });
    expect(profile).toMatchObject({
      answers,
      step: 'plans',
      completedAt: expect.any(String),
      skippedAt: null,
    });
    const appCount = await db.app.count({ where: { organizationId: ctx.organizationId } });
    expect(appCount).toBe(0);
    expect(shouldShowOnboarding({ appCount, role: ctx.role, profile })).toBe(false);
    expect(await db.organization.findUnique({ where: { id: ctx.organizationId } })).toMatchObject({
      planKey: 'free',
      isActive: false,
    });
    expect(
      await db.auditLog.count({
        where: { organizationId: ctx.organizationId, action: 'app.created' },
      }),
    ).toBe(0);
  });

  it('completes without requiring an audience or update-frequency estimate', async () => {
    const unknownUsage = { ...answers };
    delete unknownUsage.activeUsers;
    delete unknownUsage.updatesPerMonth;
    const profile = await updateOnboardingProfile(ctx, {
      action: 'complete',
      answers: unknownUsage,
    });
    expect(profile.completedAt).toEqual(expect.any(String));
    expect(profile.answers.activeUsers).toBeUndefined();
    expect(profile.answers.updatesPerMonth).toBeUndefined();
    expect(shouldShowOnboarding({ appCount: 0, role: ctx.role, profile })).toBe(false);
  });

  it('resumes an unfinished questionnaire and preserves skip across later draft saves', async () => {
    expect(await getOnboardingProfile(ctx.organizationId)).toBeNull();
    await updateOnboardingProfile(ctx, { action: 'save', answers, step: 'audience' });
    const draft = await getOnboardingProfile(ctx.organizationId);
    expect(draft).toMatchObject({ answers, step: 'audience', completedAt: null, skippedAt: null });
    expect(shouldShowOnboarding({ appCount: 0, role: ctx.role, profile: draft })).toBe(true);
    const skipped = await updateOnboardingProfile(ctx, { action: 'skip' });
    const lateDraft = await updateOnboardingProfile(ctx, {
      action: 'save',
      answers,
      step: 'audience',
    });
    expect(lateDraft.skippedAt).toBe(skipped.skippedAt);
    expect(shouldShowOnboarding({ appCount: 0, role: ctx.role, profile: lateDraft })).toBe(false);
    const completed = await updateOnboardingProfile(ctx, { action: 'complete', answers });
    expect(completed).toMatchObject({
      skippedAt: null,
      completedAt: expect.any(String),
      step: 'plans',
    });
  });

  it('completes once under concurrent requests and never reopens on stale save/skip', async () => {
    const profiles = await Promise.all(
      Array.from({ length: 4 }, () =>
        updateOnboardingProfile(ctx, { action: 'complete', answers }),
      ),
    );
    expect(new Set(profiles.map((profile) => profile.completedAt)).size).toBe(1);
    expect(
      await db.auditLog.count({
        where: { organizationId: ctx.organizationId, action: 'onboarding.completed' },
      }),
    ).toBe(1);
    const lateSave = await updateOnboardingProfile(ctx, {
      action: 'save',
      answers: {},
      step: 'app',
    });
    const lateSkip = await updateOnboardingProfile(ctx, { action: 'skip', answers: {} });
    expect(lateSave).toEqual(profiles[0]);
    expect(lateSkip).toEqual(profiles[0]);
    expect(shouldShowOnboarding({ appCount: 0, role: ctx.role, profile: lateSave })).toBe(false);
    expect(await db.app.count({ where: { organizationId: ctx.organizationId } })).toBe(0);
  });

  it('skips with a partial draft in one write and retains answers when no draft is supplied', async () => {
    const draft = { technology: 'capacitor' } as const;
    const skipped = await updateOnboardingProfile(ctx, { action: 'skip', answers: draft });
    expect(skipped).toMatchObject({
      answers: draft,
      skippedAt: expect.any(String),
      completedAt: null,
    });
    expect(shouldShowOnboarding({ appCount: 0, role: ctx.role, profile: skipped })).toBe(false);
    expect(await updateOnboardingProfile(ctx, { action: 'skip' })).toEqual(skipped);
  });

  it('keeps survey answers isolated between workspaces', async () => {
    const other = await db.organization.create({ data: { name: 'Other onboarding workspace' } });
    try {
      await updateOnboardingProfile(ctx, { action: 'complete', answers });
      await updateOnboardingProfile(
        { ...ctx, organizationId: other.id },
        { action: 'complete', answers: { ...answers, otaProvider: 'none' } },
      );
      expect((await getOnboardingProfile(ctx.organizationId))?.answers.otaProvider).toBe('capgo');
      expect((await getOnboardingProfile(other.id))?.answers.otaProvider).toBe('none');
    } finally {
      await db.organization.delete({ where: { id: other.id } });
    }
  });

  it('records unsupported platforms without adding an app to the activation funnel', async () => {
    const profile = await updateOnboardingProfile(ctx, {
      action: 'complete',
      answers: { technology: 'flutter' },
    });
    expect(profile).toMatchObject({
      completedAt: expect.any(String),
      answers: { technology: 'flutter' },
    });
    expect(await db.app.count({ where: { organizationId: ctx.organizationId } })).toBe(0);
    expect(shouldShowOnboarding({ appCount: 0, role: ctx.role, profile })).toBe(false);
  });

  it('rejects members and unfinished answers without creating a profile', async () => {
    await expect(
      updateOnboardingProfile(
        { ...ctx, role: 'member' },
        { action: 'save', answers, step: 'audience' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateOnboardingProfile(ctx, { action: 'complete', answers: {} }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      updateOnboardingProfile(ctx, {
        action: 'complete',
        answers: { ...answers, otaProvider: undefined },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await getOnboardingProfile(ctx.organizationId)).toBeNull();
  });

  it('stays completed after an app is connected and later deleted through the separate app flow', async () => {
    const profile = await updateOnboardingProfile(ctx, { action: 'complete', answers });
    const app = await db.app.create({
      data: { organizationId: ctx.organizationId, slug: 'my-app' },
    });
    await db.app.delete({ where: { id: app.id } });
    const saved = await getOnboardingProfile(ctx.organizationId);
    expect(saved).toEqual(profile);
    expect(shouldShowOnboarding({ appCount: 0, role: ctx.role, profile: saved })).toBe(false);
  });
});
