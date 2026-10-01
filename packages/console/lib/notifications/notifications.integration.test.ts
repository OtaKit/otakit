import crypto, { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { Webhook } from 'standardwebhooks';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sendNotificationEmail: vi.fn() }));

vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendNotificationEmail: mocks.sendNotificationEmail,
}));
vi.mock('@/lib/storage', () => ({
  buildFileObjectKey: (appId: string, sha256: string) => `files/${appId}/${sha256}`,
  buildPublicObjectUrl: (key: string) => `https://cdn.test/${key}`,
  deleteStorageObject: vi.fn(),
  getTextObject: vi.fn(),
  listStorageKeys: vi.fn(),
  putTextObject: vi.fn(),
}));
vi.mock('@/lib/cdn-purge', () => ({ purgeCdnUrls: vi.fn() }));

import { AUTO_REVERT_REVERTED_BY } from '@/lib/auto-revert-alerts';
import { db } from '@/lib/db';
import { encryptSecret, resetSecretBoxKeyForTests } from '@/lib/secret-box';
import {
  createNotificationDestination,
  deleteNotificationDestination,
  listNotificationDeliveries,
  redeliverNotification,
  revealWebhookSecret,
  rotateWebhookSecret,
  sendTestNotification,
  updateNotificationDestination,
} from '@/lib/services/notifications';
import {
  publishRelease,
  publishReleaseLegacy,
  revertRelease,
  updateRollout,
} from '@/lib/services/releases';

import { deliverDueNotifications } from './deliver';
import { createDefaultNotificationDestination, emitNotification } from './emit';
import { generateWebhookSecret } from './signing';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

const actor = {
  actorType: 'user' as const,
  actorId: 'notifications-test-user',
  actorLabel: 'dev@acme.test',
};
const syncManifest = vi.fn().mockResolvedValue(undefined);

type Received = { path: string; headers: http.IncomingHttpHeaders; body: string };

databaseDescribe('notifications (PostgreSQL integration)', () => {
  let server: http.Server;
  let base: string;
  let received: Received[];
  let organizationId: string;
  let appId: string;
  let otherAppId: string;
  let bundleIds: string[];
  let userIds: { owner: string; admin: string; member: string };

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        received.push({ path: request.url ?? '', headers: request.headers, body });
        if (request.url === '/fail') response.writeHead(500).end('boom');
        else if (request.url === '/gone') response.writeHead(410).end();
        else if (request.url === '/redirect') {
          response.writeHead(302, { location: 'https://elsewhere.test/' }).end();
        } else response.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.stubEnv('NOTIFICATIONS_ALLOW_PRIVATE_URLS', 'true');
    vi.stubEnv('DATA_ENCRYPTION_KEY', crypto.randomBytes(32).toString('base64'));
    vi.stubEnv('MANIFEST_SIGNING_DISABLED', 'true');
    resetSecretBoxKeyForTests();
    mocks.sendNotificationEmail.mockReset().mockResolvedValue(undefined);
    syncManifest.mockClear();
    received = [];

    organizationId = randomUUID();
    appId = randomUUID();
    otherAppId = randomUUID();
    bundleIds = [randomUUID(), randomUUID(), randomUUID()];
    userIds = { owner: randomUUID(), admin: randomUUID(), member: randomUUID() };
    await db.organization.create({
      data: {
        id: organizationId,
        name: 'Acme',
        apps: {
          create: [
            {
              id: appId,
              slug: `com.acme.${organizationId}`,
              bundles: {
                create: bundleIds.map((id, index) => ({
                  id,
                  version: `1.0.${index}`,
                  sha256: String(index).padStart(64, '0'),
                  storageKey: `notifications/${organizationId}/${index}.zip`,
                  size: 100 + index,
                  runtimeVersion: 'ios-1',
                })),
              },
            },
            { id: otherAppId, slug: `com.acme.other.${organizationId}` },
          ],
        },
      },
    });
    for (const [role, id] of Object.entries(userIds)) {
      await db.user.create({
        data: {
          id,
          name: role,
          email: `${role}-${id}@acme.test`,
          memberships: { create: { organizationId, role: role as 'owner' | 'admin' | 'member' } },
        },
      });
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetSecretBoxKeyForTests();
    await db.organization.delete({ where: { id: organizationId } });
    await db.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  function webhook(
    path: string,
    overrides: Partial<{ appId: string | null; events: string[]; enabled: boolean }> = {},
  ) {
    const id = randomUUID();
    return db.notificationDestination.create({
      data: {
        id,
        organizationId,
        type: 'webhook',
        name: path,
        url: `${base}${path}`,
        secretCiphertext: encryptSecret(generateWebhookSecret(), `notification-destination:${id}`),
        events: ['release.published'],
        ...overrides,
      },
    });
  }

  function publish(bundleIndex: number, extra: Record<string, unknown> = {}) {
    return publishRelease(
      {
        organizationId,
        actor,
        appId,
        bundleId: bundleIds[bundleIndex],
        channel: 'production',
        ...extra,
      },
      { syncManifest },
    );
  }

  async function deliveriesOf(destinationId: string) {
    const rows = await db.notificationDelivery.findMany({
      where: { destinationId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) as unknown }));
  }

  it('queues one delivery per subscribed destination, once per release', async () => {
    const allApps = await webhook('/all');
    const thisApp = await webhook('/this', { appId });
    const otherApp = await webhook('/other', { appId: otherAppId });
    const off = await webhook('/off', { enabled: false });
    const unsubscribed = await webhook('/usage', { events: ['usage.warning'] });

    const input = {
      organizationId,
      actor,
      appId,
      bundleId: bundleIds[0],
      channel: 'production',
      idempotencyKey: randomUUID(),
    };
    const result = await publishRelease(input, { syncManifest });
    await publishRelease(input, { syncManifest });

    for (const destination of [otherApp, off, unsubscribed]) {
      await expect(deliveriesOf(destination.id)).resolves.toHaveLength(0);
    }
    for (const destination of [allApps, thisApp]) {
      const deliveries = await deliveriesOf(destination.id);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        eventType: 'release.published',
        eventKey: `release.published:${result.release.id}`,
        status: 'pending',
        payload: {
          type: 'release.published',
          data: {
            organization: { id: organizationId, name: 'Acme' },
            app: { id: appId, slug: `com.acme.${organizationId}` },
            actor: { type: 'user', label: 'dev@acme.test' },
            url: `https://console.example/dashboard?app=${appId}`,
            release: { id: result.release.id, bundleVersion: '1.0.0', channel: 'production' },
            previousRelease: null,
          },
        },
      });
    }
  });

  it('reports rollout steps, reverts and auto-reverts', async () => {
    const destination = await webhook('/all', {
      events: ['release.rollout_updated', 'release.reverted', 'release.auto_reverted'],
    });
    const stable = await publish(0);
    const rolling = await publish(1, { rolloutPercent: 10 });
    await updateRollout(
      { organizationId, actor, appId, releaseId: rolling.release.id, percent: 50 },
      { syncManifest },
    );
    await updateRollout(
      { organizationId, actor, appId, releaseId: rolling.release.id, percent: 100 },
      { syncManifest },
    );
    await revertRelease(
      { organizationId, actor, appId, releaseId: rolling.release.id },
      { syncManifest },
    );
    const bad = await publish(2);
    const health = {
      appId,
      channel: 'production',
      runtimeVersion: 'ios-1',
      bundleVersion: '1.0.2',
      rollbacks: 12,
      attempts: 20,
      measuredRatePercent: 60,
      ratePercent: 20,
      minSample: 10,
      windowHours: 24,
    };
    await revertRelease(
      {
        organizationId,
        actor: { actorType: 'system', actorLabel: 'auto-revert' },
        appId,
        releaseId: bad.release.id,
        revertedBy: AUTO_REVERT_REVERTED_BY,
        autoRevertAlertPayload: health,
      },
      { syncManifest },
    );

    const deliveries = await deliveriesOf(destination.id);
    expect(deliveries.map((delivery) => delivery.eventType)).toEqual([
      'release.rollout_updated',
      'release.rollout_updated',
      'release.reverted',
      'release.auto_reverted',
    ]);
    expect(new Set(deliveries.map((delivery) => delivery.eventKey)).size).toBe(4);
    expect(deliveries[0].payload).toMatchObject({
      data: { release: { rolloutPercent: 50 }, previousPercent: 10 },
    });
    expect(deliveries[2].payload).toMatchObject({
      data: { release: { id: rolling.release.id }, currentRelease: { id: stable.release.id } },
    });
    expect(deliveries[3].payload).toMatchObject({
      data: {
        actor: { type: 'system', label: 'auto-revert' },
        release: { id: bad.release.id, revertedBy: AUTO_REVERT_REVERTED_BY },
        currentRelease: { id: stable.release.id },
        health: { rollbacks: 12, attempts: 20, measuredRatePercent: 60, ratePercent: 20 },
      },
    });
  });

  it('notifies from the legacy release path too', async () => {
    const destination = await webhook('/all');
    const result = await publishReleaseLegacy(
      { organizationId, actor, appId, bundleId: bundleIds[0], channel: null },
      { syncManifest },
    );
    await expect(deliveriesOf(destination.id)).resolves.toMatchObject([
      { eventKey: `release.published:${result.release.id}` },
    ]);
  });

  it('delivers webhooks that the Standard Webhooks library verifies', async () => {
    const { destination, secret } = await createNotificationDestination(
      { organizationId, actor },
      { type: 'webhook', name: 'CI', url: `${base}/ok`, events: ['release.published'] },
    );
    await publish(0);

    await expect(deliverDueNotifications()).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      failed: 0,
    });
    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request.headers['user-agent']).toBe('OtaKit-Webhooks/1.0');
    const verified = new Webhook(secret!).verify(request.body, {
      'webhook-id': String(request.headers['webhook-id']),
      'webhook-timestamp': String(request.headers['webhook-timestamp']),
      'webhook-signature': String(request.headers['webhook-signature']),
    });
    expect(verified).toMatchObject({ type: 'release.published' });
    // The body is sent exactly as emitted, in its original key order.
    expect(Object.keys(JSON.parse(request.body))).toEqual(['type', 'timestamp', 'data']);

    const [delivery] = await deliveriesOf(destination.id);
    expect(request.headers['webhook-id']).toBe(delivery.id);
    expect(delivery).toMatchObject({ status: 'delivered', attempts: 1, lastStatusCode: 204 });
    await expect(
      db.notificationDestination.findUniqueOrThrow({ where: { id: destination.id } }),
    ).resolves.toMatchObject({ consecutiveFailures: 0, lastSuccessAt: expect.any(Date) });
  });

  it('retries failures on the schedule, then gives up', async () => {
    const destination = await webhook('/fail');
    await publish(0);

    const before = Date.now();
    await deliverDueNotifications();
    let [delivery] = await deliveriesOf(destination.id);
    expect(delivery).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastStatusCode: 500,
      lastError: 'HTTP 500: boom',
    });
    expect(delivery.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    // Not due yet.
    await expect(deliverDueNotifications()).resolves.toMatchObject({ claimed: 0 });

    await db.notificationDelivery.update({
      where: { id: delivery.id },
      data: { attempts: 7, nextAttemptAt: new Date() },
    });
    await deliverDueNotifications();
    [delivery] = await deliveriesOf(destination.id);
    expect(delivery).toMatchObject({ status: 'failed', attempts: 8 });
    await expect(
      db.notificationDestination.findUniqueOrThrow({ where: { id: destination.id } }),
    ).resolves.toMatchObject({ enabled: true, consecutiveFailures: 2 });
  });

  it('treats a redirect as a failure and never follows it', async () => {
    const destination = await webhook('/redirect');
    await publish(0);
    await deliverDueNotifications();
    const [delivery] = await deliveriesOf(destination.id);
    expect(delivery.lastError).toBe(
      'HTTP 302: redirects are not followed (to https://elsewhere.test/)',
    );
    expect(received.map((request) => request.path)).toEqual(['/redirect']);
  });

  it('turns a destination off on 410 and tells the owners and admins', async () => {
    const destination = await webhook('/gone', {
      events: ['release.published', 'release.reverted'],
    });
    const result = await publish(0);
    await deliverDueNotifications();
    // A turned-off destination gets nothing new.
    await emitNotification(db, {
      type: 'release.reverted',
      key: 'late',
      organizationId,
      appId,
      actor,
      data: { release: result.release, currentRelease: null },
    });

    await expect(
      db.notificationDestination.findUniqueOrThrow({ where: { id: destination.id } }),
    ).resolves.toMatchObject({ enabled: false, disabledReason: 'endpoint_gone' });
    const deliveries = await deliveriesOf(destination.id);
    expect(deliveries.map((delivery) => delivery.status)).toEqual(['failed']);
    expect(mocks.sendNotificationEmail.mock.calls.map(([email]) => email.to).sort()).toEqual(
      [`admin-${userIds.admin}@acme.test`, `owner-${userIds.owner}@acme.test`].sort(),
    );
    expect(mocks.sendNotificationEmail.mock.calls[0][0].subject).toBe(
      'Notifications to "/gone" turned off (Acme)',
    );
  });

  it('turns a destination off after three days of failures', async () => {
    const destination = await webhook('/fail');
    await db.notificationDestination.update({
      where: { id: destination.id },
      data: {
        consecutiveFailures: 4,
        lastSuccessAt: new Date(Date.now() - 73 * 60 * 60 * 1000),
      },
    });
    await publish(0);
    await deliverDueNotifications();
    await expect(
      db.notificationDestination.findUniqueOrThrow({ where: { id: destination.id } }),
    ).resolves.toMatchObject({ enabled: false, disabledReason: 'failing', consecutiveFailures: 5 });
    await expect(deliveriesOf(destination.id)).resolves.toMatchObject([{ status: 'failed' }]);
  });

  it('never sends a delivery twice when workers race', async () => {
    const destination = await webhook('/ok', { events: ['bundle.uploaded'] });
    for (let index = 0; index < 25; index += 1) {
      await emitNotification(db, {
        type: 'bundle.uploaded',
        key: `bundle.uploaded:${index}`,
        organizationId,
        appId,
        actor,
        data: {
          bundle: {
            id: String(index),
            version: `2.0.${index}`,
            runtimeVersion: null,
            size: 1,
            strategy: 'zip',
            createdAt: new Date().toISOString(),
          },
        },
      });
    }
    const runs = await Promise.all([
      deliverDueNotifications(),
      deliverDueNotifications(),
      deliverDueNotifications(),
    ]);
    expect(runs.reduce((sum, run) => sum + run.claimed, 0)).toBe(25);
    const ids = received.map((request) => request.headers['webhook-id']);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    await expect(
      db.notificationDelivery.count({
        where: { destinationId: destination.id, status: 'delivered' },
      }),
    ).resolves.toBe(25);
  });

  it('picks up a delivery that a crashed worker left behind', async () => {
    const destination = await webhook('/ok');
    await publish(0);
    await db.notificationDelivery.updateMany({
      where: { destinationId: destination.id },
      data: { status: 'sending', claimedAt: new Date(Date.now() - 10 * 60 * 1000), attempts: 1 },
    });
    await deliverDueNotifications();
    await expect(deliveriesOf(destination.id)).resolves.toMatchObject([
      { status: 'delivered', attempts: 2 },
    ]);
  });

  it('emails owners and admins, or the chosen members', async () => {
    const team = await createDefaultNotificationDestination(db, organizationId);
    const chosen = await db.notificationDestination.create({
      data: {
        organizationId,
        type: 'email',
        name: 'Billing',
        emailRecipients: { mode: 'members', userIds: [userIds.member] },
        events: ['usage.warning'],
      },
    });
    await emitNotification(db, {
      type: 'usage.warning',
      key: 'usage.warning:2026-10-01:90:5000',
      organizationId,
      appId: null,
      actor: null,
      data: {
        usage: {
          threshold: 90,
          downloadsCount: 4500,
          limit: 5000,
          periodStart: '2026-10-01T00:00:00.000Z',
        },
      },
    });
    await deliverDueNotifications();

    const calls = mocks.sendNotificationEmail.mock.calls.map(([email]) => email);
    expect(calls.map((email) => email.to).sort()).toEqual(
      [
        `admin-${userIds.admin}@acme.test`,
        `member-${userIds.member}@acme.test`,
        `owner-${userIds.owner}@acme.test`,
      ].sort(),
    );
    expect(calls[0].subject).toBe('Usage reached 90% for Acme');
    const [teamDelivery] = await deliveriesOf(team.id);
    expect(calls.map((email) => email.idempotencyKey)).toContain(
      `notification:${teamDelivery.id}:owner-${userIds.owner}@acme.test`,
    );
    await expect(deliveriesOf(chosen.id)).resolves.toMatchObject([{ status: 'delivered' }]);
  });

  it('retries an email delivery when the provider fails', async () => {
    const team = await createDefaultNotificationDestination(db, organizationId);
    mocks.sendNotificationEmail.mockRejectedValueOnce(new Error('Resend failed: rate limited'));
    await emitNotification(db, {
      type: 'usage.warning',
      key: 'usage',
      organizationId,
      appId: null,
      actor: null,
      data: {
        usage: {
          threshold: 100,
          downloadsCount: 1,
          limit: 1,
          periodStart: new Date().toISOString(),
        },
      },
    });
    await deliverDueNotifications();
    await expect(deliveriesOf(team.id)).resolves.toMatchObject([
      { status: 'pending', lastError: 'Resend failed: rate limited' },
    ]);
  });

  it('formats messages for Slack and Discord', async () => {
    const slack = await db.notificationDestination.create({
      data: {
        organizationId,
        type: 'slack',
        name: 'Slack',
        url: `${base}/slack`,
        events: ['release.published'],
      },
    });
    const discord = await db.notificationDestination.create({
      data: {
        organizationId,
        type: 'discord',
        name: 'Discord',
        url: `${base}/discord`,
        events: ['release.published'],
      },
    });
    await publish(0);
    await deliverDueNotifications();

    const byPath = Object.fromEntries(received.map((request) => [request.path, request]));
    expect(JSON.parse(byPath['/slack'].body)).toMatchObject({
      text: `Released com.acme.${organizationId} 1.0.0 (production / runtime ios-1)`,
      blocks: [{ type: 'section' }, { type: 'context' }],
    });
    expect(JSON.parse(byPath['/discord'].body)).toMatchObject({
      embeds: [{ title: `Released com.acme.${organizationId} 1.0.0 (production / runtime ios-1)` }],
    });
    expect(byPath['/slack'].headers['webhook-signature']).toBeUndefined();
    for (const destination of [slack, discord]) {
      await expect(deliveriesOf(destination.id)).resolves.toMatchObject([{ status: 'delivered' }]);
    }
  });

  describe('settings', () => {
    const context = () => ({ organizationId, actor });

    it('creates a webhook with a sealed secret, tests it, and rotates the secret', async () => {
      const { destination, secret } = await createNotificationDestination(context(), {
        type: 'webhook',
        name: ' CI ',
        url: `${base}/ok`,
        appId,
        events: ['release.published', 'release.published'],
      });
      expect(destination).toMatchObject({ name: 'CI', appId, events: ['release.published'] });
      const row = await db.notificationDestination.findUniqueOrThrow({
        where: { id: destination.id },
      });
      expect(row.secretCiphertext).toMatch(/^v1\./);
      expect(row.secretCiphertext).not.toContain(secret!.slice(6));
      await expect(revealWebhookSecret(organizationId, destination.id)).resolves.toBe(secret);

      const test = await sendTestNotification(context(), destination.id);
      expect(test).toMatchObject({
        eventType: 'test.ping',
        status: 'delivered',
        lastStatusCode: 204,
      });
      const headers = (request: Received) => ({
        'webhook-id': String(request.headers['webhook-id']),
        'webhook-timestamp': String(request.headers['webhook-timestamp']),
        'webhook-signature': String(request.headers['webhook-signature']),
      });
      expect(new Webhook(secret!).verify(received[0].body, headers(received[0]))).toMatchObject({
        type: 'test.ping',
        data: { message: 'This destination receives OtaKit notifications.' },
      });

      const rotated = await rotateWebhookSecret(context(), destination.id);
      expect(rotated).not.toBe(secret);
      await sendTestNotification(context(), destination.id);
      const signed = received[1];
      expect(String(signed.headers['webhook-signature']).split(' ')).toHaveLength(2);
      expect(new Webhook(rotated).verify(signed.body, headers(signed))).toBeTruthy();
      expect(new Webhook(secret!).verify(signed.body, headers(signed))).toBeTruthy();
      await expect(
        db.auditLog.findMany({
          where: { organizationId, targetId: destination.id },
          orderBy: { createdAt: 'asc' },
          select: { action: true },
        }),
      ).resolves.toEqual([
        { action: 'notification_destination.created' },
        { action: 'notification_destination.secret_rotated' },
      ]);
    });

    it('does not retry a failed test', async () => {
      const { destination } = await createNotificationDestination(context(), {
        type: 'webhook',
        name: 'Broken',
        url: `${base}/fail`,
        events: ['release.published'],
      });
      await expect(sendTestNotification(context(), destination.id)).resolves.toMatchObject({
        status: 'failed',
        attempts: 1,
        lastError: 'HTTP 500: boom',
      });
    });

    it('turns a destination off and on, and redelivers', async () => {
      const { destination } = await createNotificationDestination(context(), {
        type: 'webhook',
        name: 'CI',
        url: `${base}/fail`,
        events: ['release.published'],
      });
      await publish(0);
      await deliverDueNotifications();
      const [failed] = await deliveriesOf(destination.id);
      expect(failed.status).toBe('pending');

      await expect(
        updateNotificationDestination(context(), destination.id, { enabled: false }),
      ).resolves.toMatchObject({ enabled: false, disabledReason: null });
      await expect(deliveriesOf(destination.id)).resolves.toMatchObject([
        { status: 'failed', lastError: 'Destination turned off' },
      ]);
      await expect(
        redeliverNotification(organizationId, destination.id, failed.id),
      ).rejects.toMatchObject({ status: 409 });

      await updateNotificationDestination(context(), destination.id, {
        enabled: true,
        url: `${base}/ok`,
      });
      await expect(
        db.notificationDestination.findUniqueOrThrow({ where: { id: destination.id } }),
      ).resolves.toMatchObject({ enabled: true, consecutiveFailures: 0, url: `${base}/ok` });
      await expect(
        redeliverNotification(organizationId, destination.id, failed.id),
      ).resolves.toMatchObject({ id: failed.id, status: 'delivered', attempts: 1 });
      await expect(
        listNotificationDeliveries(organizationId, destination.id),
      ).resolves.toHaveLength(1);
    });

    it('writes and audits only what changed', async () => {
      const { destination } = await createNotificationDestination(context(), {
        type: 'webhook',
        name: 'CI',
        url: `${base}/ok`,
        events: ['release.reverted', 'release.published'],
      });
      expect(destination.events).toEqual(['release.published', 'release.reverted']);
      const unchanged = {
        name: 'CI',
        url: `${base}/ok`,
        appId: null,
        events: ['release.published', 'release.reverted'],
      };
      await updateNotificationDestination(context(), destination.id, unchanged);
      await updateNotificationDestination(context(), destination.id, {
        ...unchanged,
        name: 'CI builds',
      });
      await expect(
        db.auditLog.findMany({
          where: { organizationId, targetId: destination.id },
          orderBy: { createdAt: 'asc' },
          select: { action: true, metadata: true },
        }),
      ).resolves.toEqual([
        expect.objectContaining({ action: 'notification_destination.created' }),
        {
          action: 'notification_destination.updated',
          metadata: { name: 'CI builds', type: 'webhook', changes: ['name'] },
        },
      ]);
    });

    it('validates input', async () => {
      const create = (body: Record<string, unknown>) =>
        createNotificationDestination(context(), {
          type: 'webhook',
          name: 'CI',
          url: `${base}/ok`,
          events: ['release.published'],
          ...body,
        });
      await expect(create({ type: 'sms' })).rejects.toMatchObject({ status: 400 });
      await expect(create({ name: '' })).rejects.toMatchObject({ status: 400 });
      await expect(create({ events: [] })).rejects.toMatchObject({ status: 400 });
      await expect(create({ events: ['test.ping'] })).rejects.toMatchObject({ status: 400 });
      await expect(create({ url: 'ftp://example.com' })).rejects.toMatchObject({ status: 400 });
      await expect(create({ appId: randomUUID() })).rejects.toMatchObject({ status: 404 });
      await expect(
        create({ type: 'slack', url: 'https://example.com/hook' }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        create({
          type: 'email',
          url: undefined,
          emailRecipients: { mode: 'members', userIds: [randomUUID()] },
        }),
      ).rejects.toMatchObject({ message: 'Every recipient must be a member' });
      await expect(
        create({ type: 'email', emailRecipients: { mode: 'members', userIds: [userIds.member] } }),
      ).resolves.toMatchObject({
        destination: { type: 'email', url: null, emailRecipients: { mode: 'members' } },
        secret: null,
      });
    });

    it('limits destinations per workspace', async () => {
      await db.notificationDestination.createMany({
        data: Array.from({ length: 20 }, (_, index) => ({
          organizationId,
          type: 'email' as const,
          name: `Email ${index}`,
          emailRecipients: { mode: 'owners_admins' },
          events: ['usage.warning'],
        })),
      });
      await expect(
        createNotificationDestination(context(), {
          type: 'email',
          name: 'One more',
          emailRecipients: { mode: 'owners_admins' },
          events: ['usage.warning'],
        }),
      ).rejects.toMatchObject({ code: 'NOTIFICATION_LIMIT_REACHED' });
    });

    it('deletes a destination with its deliveries, only within the workspace', async () => {
      const { destination } = await createNotificationDestination(context(), {
        type: 'webhook',
        name: 'CI',
        url: `${base}/ok`,
        events: ['release.published'],
      });
      await publish(0);
      await expect(
        deleteNotificationDestination({ organizationId: randomUUID(), actor }, destination.id),
      ).rejects.toMatchObject({ status: 404 });
      await deleteNotificationDestination(context(), destination.id);
      await expect(
        db.notificationDelivery.count({ where: { destinationId: destination.id } }),
      ).resolves.toBe(0);
    });
  });
});
