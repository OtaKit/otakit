import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/lib/db';
import type { SessionContext } from '@/lib/session';
import type { OnboardingAnswers } from '@/lib/onboarding-profile';
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
  selectedPlan: 'free',
};

databaseDescribe('onboarding profile (PostgreSQL integration)', () => {
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

  it('saves, resumes, and skips without creating an app or changing billing', async () => {
    expect(await getOnboardingProfile(ctx.organizationId)).toBeNull();
    await updateOnboardingProfile(ctx, { action: 'save', answers, step: 'plans' });
    expect(await getOnboardingProfile(ctx.organizationId)).toMatchObject({
      answers,
      step: 'plans',
      completedAt: null,
      skippedAt: null,
      connectedApp: null,
    });
    expect(await updateOnboardingProfile(ctx, { action: 'skip' })).toMatchObject({
      answers,
      skippedAt: expect.any(String),
    });
    expect(
      await updateOnboardingProfile(ctx, { action: 'save', answers, step: 'plans' }),
    ).toMatchObject({ skippedAt: null });
    expect(await db.app.count({ where: { organizationId: ctx.organizationId } })).toBe(0);
    expect(await db.organization.findUnique({ where: { id: ctx.organizationId } })).toMatchObject({
      planKey: 'free',
      isActive: false,
    });
  });

  it('creates one app and one creation audit event under concurrent finish requests', async () => {
    const profiles = await Promise.all(
      Array.from({ length: 4 }, () =>
        updateOnboardingProfile(ctx, {
          action: 'complete',
          answers: { ...answers, selectedPlan: 'pro', billingInterval: 'year' },
          slug: 'my-app',
        }),
      ),
    );
    expect(new Set(profiles.map((profile) => profile.connectedApp?.id)).size).toBe(1);
    expect(profiles.filter((profile) => profile.appCreated)).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      completedAt: expect.any(String),
      connectedApp: { slug: 'my-app' },
    });
    expect(await db.app.count({ where: { organizationId: ctx.organizationId } })).toBe(1);
    expect(
      await db.auditLog.count({
        where: { organizationId: ctx.organizationId, action: 'app.created' },
      }),
    ).toBe(1);
    expect(await db.organization.findUnique({ where: { id: ctx.organizationId } })).toMatchObject({
      planKey: 'free',
      isActive: false,
    });
    const lateSave = await updateOnboardingProfile(ctx, {
      action: 'save',
      answers: {},
      step: 'app',
    });
    expect(lateSave.connectedApp).toEqual(profiles[0].connectedApp);
    expect(lateSave.completedAt).toBe(profiles[0].completedAt);
  });

  it('reuses an app registered in the same workspace while onboarding was open', async () => {
    const app = await db.app.create({
      data: { organizationId: ctx.organizationId, slug: 'my-app' },
    });
    const profile = await updateOnboardingProfile(ctx, {
      action: 'complete',
      answers,
      slug: 'my-app',
    });
    expect(profile.connectedApp?.id).toBe(app.id);
    expect(profile.appCreated).toBe(false);
    expect(
      await db.auditLog.count({
        where: { organizationId: ctx.organizationId, action: 'app.created' },
      }),
    ).toBe(0);
  });

  it('keeps identical identifiers and answers isolated between workspaces', async () => {
    const other = await db.organization.create({ data: { name: 'Other onboarding workspace' } });
    try {
      const first = await updateOnboardingProfile(ctx, {
        action: 'complete',
        answers,
        slug: 'my-app',
      });
      const second = await updateOnboardingProfile(
        { ...ctx, organizationId: other.id },
        { action: 'complete', answers: { ...answers, otaProvider: 'none' }, slug: 'my-app' },
      );
      expect(second.connectedApp?.id).not.toBe(first.connectedApp?.id);
      expect((await getOnboardingProfile(ctx.organizationId))?.answers.otaProvider).toBe('capgo');
    } finally {
      await db.organization.delete({ where: { id: other.id } });
    }
  });

  it('records unsupported platforms without adding a fake app to the activation funnel', async () => {
    const profile = await updateOnboardingProfile(ctx, {
      action: 'complete',
      answers: { technology: 'flutter' },
    });
    expect(profile).toMatchObject({
      completedAt: expect.any(String),
      connectedApp: null,
      answers: { technology: 'flutter' },
    });
    expect(await db.app.count({ where: { organizationId: ctx.organizationId } })).toBe(0);
    await expect(
      updateOnboardingProfile(ctx, {
        action: 'complete',
        answers: { technology: 'flutter' },
        slug: 'fake-app',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects members and incomplete connections without writing data', async () => {
    await expect(
      updateOnboardingProfile(
        { ...ctx, role: 'member' },
        { action: 'save', answers, step: 'plans' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateOnboardingProfile(ctx, { action: 'complete', answers: {}, slug: 'my-app' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      updateOnboardingProfile(ctx, { action: 'complete', answers, slug: 'a b' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await getOnboardingProfile(ctx.organizationId)).toBeNull();
  });

  it('retains survey answers when the app is deleted', async () => {
    const profile = await updateOnboardingProfile(ctx, {
      action: 'complete',
      answers,
      slug: 'my-app',
    });
    await db.app.delete({ where: { id: profile.connectedApp!.id } });
    expect(await getOnboardingProfile(ctx.organizationId)).toMatchObject({
      connectedApp: null,
      completedAt: expect.any(String),
      answers,
    });
  });
});
