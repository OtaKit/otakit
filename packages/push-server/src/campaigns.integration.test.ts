import crypto, { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApnsResult } from './apns';
import { pushDb } from './db';
import { claimBatches, processBatch } from './deliver';
import type { PushHost } from './host';
import { encryptSecret, resetSecretBoxKeyForTests } from './secret-box';
import { createPushService } from './service';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

const actorLabel = 'push@example.com';
const host: PushHost = { getWorkspace: async () => ({ plan: 'free', periodStart: null }) };
const push = createPushService(host);

databaseDescribe('push campaigns (PostgreSQL integration)', () => {
  // Created in a hook so the suite can be collected (and skipped) without a database.
  let db: ReturnType<typeof pushDb>;
  let organizationId: string;
  let appId: string;

  beforeAll(() => {
    db = pushDb();
  });

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
        {
          organizationId,
          appId,
          platform: 'ios',
          provider: 'apns',
          token: 'a'.repeat(64),
          topics: ['news'],
        },
        {
          organizationId,
          appId,
          platform: 'ios',
          provider: 'apns',
          token: 'b'.repeat(64),
          topics: [],
        },
        {
          organizationId,
          appId,
          platform: 'ios',
          provider: 'apns',
          token: 'c'.repeat(64),
          topics: ['news'],
        },
        {
          organizationId,
          appId,
          platform: 'android',
          provider: 'fcm',
          token: 'fcm-x',
          topics: ['news'],
        },
      ],
    });
  });

  afterAll(async () => {
    await db.pushUsage.deleteMany({});
    await db.pushCampaign.deleteMany({});
    await db.pushDevice.deleteMany({});
    await db.pushCredential.deleteMany({});
  });

  it('targets reachable devices, sends, prunes, retries and completes', async () => {
    const { campaign, created } = await push.createCampaign({
      organizationId,
      appId,
      actorLabel,
      payload: { title: 'Hi', body: 'There' },
      audience: { topics: ['news'] },
      idempotencyKey: 'k1',
    });
    // Android has no Firebase credential, so only the two iOS "news" devices count.
    expect(campaign.targeted).toBe(2);
    expect(created).toBe(true);

    const replay = await push.createCampaign({
      organizationId,
      appId,
      actorLabel,
      payload: { title: 'Hi', body: 'There' },
      audience: { topics: ['news'] },
      idempotencyKey: 'k1',
    });
    expect(replay).toMatchObject({ created: false, campaign: { id: campaign.id } });

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
    await processBatch(host, batch, senders as never);

    const done = await db.pushCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(done).toMatchObject({ status: 'completed', accepted: 1, invalidRemoved: 1, failed: 0 });
    expect(done.errorSummary).toEqual({ 'apns:Unregistered': 1 });
    expect(await db.pushDevice.count({ where: { id: goneId } })).toBe(0);
    const usage = await db.pushUsage.findFirstOrThrow({ where: { organizationId } });
    expect(usage.sends).toBe(1);
  });

  it('requeues temporary failures and stops a campaign on credential rejection', async () => {
    const { campaign } = await push.createCampaign({
      organizationId,
      appId,
      actorLabel,
      payload: { title: 'Hi', body: 'There' },
      audience: { platforms: ['ios'] },
    });
    const [batch] = await claimBatches(5);
    await processBatch(host, batch, {
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
    await processBatch(host, again, {
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
    const overview = await push.getDeviceOverview(appId);
    expect(overview).toMatchObject({ total: 4, ios: 3, android: 1, iosSandbox: 0 });
    expect(overview.topics).toEqual([{ topic: 'news', count: 3 }]);
    const found = await push.listDevices({ appId, search: 'a'.repeat(12) });
    expect(found).toHaveLength(1);
    expect(found[0].tokenPreview).toBe(`${'a'.repeat(10)}…`);
    const usage = await push.getUsage(organizationId);
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
      push.createCampaign({
        organizationId,
        appId,
        actorLabel,
        payload: { title: 'a', body: 'b' },
        audience: {},
      }),
    ).rejects.toMatchObject({ code: 'PUSH_LIMIT_REACHED' });
    await expect(
      push.createCampaign({
        organizationId,
        appId,
        actorLabel,
        payload: { title: 'a', body: 'b' },
        audience: { userIds: ['nobody'] },
      }),
    ).rejects.toThrow(/No devices match/);
  });

  it('counts devices per workspace and removes the data of one app', async () => {
    const app = { appId, organizationId };
    // APNs tokens are stored lowercase, so this updates the existing device.
    expect(
      await push.registerDevice(app, { token: 'A'.repeat(64), platform: 'ios', topics: ['x'] }),
    ).toMatchObject({ accepted: true, created: false });

    const otherAppId = randomUUID();
    expect(
      await push.registerDevice(
        { appId: otherAppId, organizationId },
        { token: 'other-token', platform: 'android' },
      ),
    ).toMatchObject({ accepted: true, created: true });
    expect(await push.getUsage(organizationId)).toMatchObject({ devices: 5 });

    await push.deleteAppData(appId);
    expect(await db.pushDevice.count({ where: { appId } })).toBe(0);
    expect(await db.pushCredential.count({ where: { appId } })).toBe(0);
    expect(await db.pushDevice.count({ where: { organizationId } })).toBe(1);
  });
});
