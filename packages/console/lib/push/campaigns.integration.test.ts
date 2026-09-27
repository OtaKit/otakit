import crypto, { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptSecret, resetSecretBoxKeyForTests } from '@/lib/crypto/secret-box';
import { db } from '@/lib/db';

import type { ApnsResult } from './apns';
import { createCampaign } from './campaigns';
import { claimBatches, processBatch } from './deliver';
import { getDeviceOverview, getPushUsage, listDevices } from './device-admin';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

const actor = { actorType: 'user' as const, actorId: 'push-test', actorLabel: 'push@example.com' };

databaseDescribe('push campaigns (PostgreSQL integration)', () => {
  let organizationId: string;
  let appId: string;

  beforeEach(async () => {
    process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    resetSecretBoxKeyForTests();
    // Leave no claimable batches from earlier tests behind.
    await db.pushSendBatch.updateMany({
      where: { status: { not: 'done' } },
      data: { status: 'done' },
    });

    organizationId = randomUUID();
    appId = randomUUID();
    await db.organization.create({
      data: {
        id: organizationId,
        name: `Push integration ${organizationId}`,
        apps: { create: { id: appId, slug: `push.${organizationId}` } },
      },
    });
    await db.pushCredential.create({
      data: {
        appId,
        provider: 'apns',
        sealedSecret: encryptSecret('unused', `push-credential:${appId}:apns`),
        apnsKeyId: 'ABC123DEFG',
        apnsTeamId: 'TEAM123456',
        apnsBundleId: 'com.example.app',
        createdBy: 'test',
      },
    });
    await db.pushDevice.createMany({
      data: [
        { appId, platform: 'ios', provider: 'apns', token: 'a'.repeat(64), topics: ['news'] },
        { appId, platform: 'ios', provider: 'apns', token: 'b'.repeat(64), topics: [] },
        { appId, platform: 'ios', provider: 'apns', token: 'c'.repeat(64), topics: ['news'] },
        { appId, platform: 'android', provider: 'fcm', token: 'fcm-x', topics: ['news'] },
      ],
    });
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { name: { startsWith: 'Push integration' } } });
  });

  it('targets reachable devices, sends, prunes, retries and completes', async () => {
    const campaign = await createCampaign({
      organizationId,
      appId,
      actor,
      payload: { title: 'Hi', body: 'There' },
      audience: { topics: ['news'] },
      idempotencyKey: 'k1',
    });
    // Android has no Firebase credential, so only the two iOS "news" devices count.
    expect(campaign.targeted).toBe(2);

    const replay = await createCampaign({
      organizationId,
      appId,
      actor,
      payload: { title: 'Hi', body: 'There' },
      audience: { topics: ['news'] },
      idempotencyKey: 'k1',
    });
    expect(replay.id).toBe(campaign.id);

    const devices = await db.pushDevice.findMany({ where: { appId, provider: 'apns' } });
    const goneId = devices.find((device) => device.token === 'c'.repeat(64))!.id;
    const senders = {
      apns: vi.fn(
        async ({ items }): Promise<ApnsResult[]> =>
          items.map((item: { deviceId: string }) =>
            item.deviceId === goneId
              ? { deviceId: item.deviceId, kind: 'invalid', status: 410, reason: 'Unregistered' }
              : { deviceId: item.deviceId, kind: 'ok', status: 200 },
          ),
      ),
      fcm: vi.fn(),
    };

    const [batch] = await claimBatches(5);
    expect(batch.campaignId).toBe(campaign.id);
    expect(batch.attempts).toBe(1);
    expect(await claimBatches(5)).toEqual([]); // claimed batches are locked out
    await processBatch(batch, senders as never);

    const done = await db.pushCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(done).toMatchObject({ status: 'completed', accepted: 1, invalidRemoved: 1, failed: 0 });
    expect(done.errorSummary).toEqual({ 'apns:Unregistered': 1 });
    expect(await db.pushDevice.count({ where: { id: goneId } })).toBe(0);
    const usage = await db.pushUsage.findFirstOrThrow({ where: { organizationId } });
    expect(usage.sends).toBe(1);
  });

  it('requeues temporary failures and stops a campaign on credential rejection', async () => {
    const campaign = await createCampaign({
      organizationId,
      appId,
      actor,
      payload: { title: 'Hi', body: 'There' },
      audience: { platforms: ['ios'] },
    });
    const [batch] = await claimBatches(5);
    await processBatch(batch, {
      apns: vi.fn(
        async ({ items }): Promise<ApnsResult[]> =>
          items.map((item: { deviceId: string }) => ({
            deviceId: item.deviceId,
            kind: 'retry',
            status: 503,
            reason: 'ServiceUnavailable',
          })),
      ),
      fcm: vi.fn(),
    } as never);

    const retry = await db.pushSendBatch.findFirstOrThrow({
      where: { campaignId: campaign.id, status: 'pending' },
    });
    expect(retry.deviceIds).toHaveLength(3);
    expect(retry.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect((await db.pushCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(
      'sending',
    );

    await db.pushSendBatch.update({
      where: { id: retry.id },
      data: { nextAttemptAt: new Date(0) },
    });
    const [again] = await claimBatches(5);
    expect(again.attempts).toBe(2);
    await processBatch(again, {
      apns: vi.fn(
        async ({ items }): Promise<ApnsResult[]> =>
          items.map((item: { deviceId: string }) => ({
            deviceId: item.deviceId,
            kind: 'auth',
            status: 403,
            reason: 'InvalidProviderToken',
          })),
      ),
      fcm: vi.fn(),
    } as never);

    const failed = await db.pushCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toMatch(/Apple rejected the credentials/);
  });

  it('summarizes devices by platform, channel and topic', async () => {
    const overview = await getDeviceOverview(appId);
    expect(overview).toMatchObject({ total: 4, ios: 3, android: 1, iosSandbox: 0 });
    expect(overview.topics).toEqual([{ topic: 'news', count: 3 }]);
    const found = await listDevices({ appId, search: 'a'.repeat(12) });
    expect(found).toHaveLength(1);
    expect(found[0].tokenPreview).toBe(`${'a'.repeat(10)}…`);
    const usage = await getPushUsage(organizationId);
    expect(usage).toMatchObject({
      sends: 0,
      sendsLimit: 100_000,
      devices: 4,
      devicesLimit: 10_000,
    });
  });

  it('refuses to send past the monthly limit and when nothing matches', async () => {
    await db.pushUsage.create({
      data: {
        organizationId,
        periodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)),
        sends: 100_000,
      },
    });
    await expect(
      createCampaign({
        organizationId,
        appId,
        actor,
        payload: { title: 'a', body: 'b' },
        audience: {},
      }),
    ).rejects.toMatchObject({ code: 'PUSH_LIMIT_REACHED' });
    await expect(
      createCampaign({
        organizationId,
        appId,
        actor,
        payload: { title: 'a', body: 'b' },
        audience: { userIds: ['nobody'] },
      }),
    ).rejects.toThrow(/No devices match/);
  });
});
