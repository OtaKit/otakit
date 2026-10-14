import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ErrorActivity, ErrorGroup } from '@/lib/tinybird/errors';

const tinybird = vi.hoisted(() => ({
  activity: [] as ErrorActivity[] | null,
  groups: [] as ErrorGroup[],
  releaseErrors: new Map<string, { events: number; issues: number }>(),
  applies: new Map<string, number>(),
  usage: new Map<string, number>() as Map<string, number> | null,
  issueReleases: new Map<string, { lastSeenAt: Date; lastOccurredAt: Date; events: number }>(),
}));
const gate = vi.hoisted(() => ({
  replaceTelemetryApps: vi.fn(async () => true),
  pauseTelemetry: vi.fn(async () => undefined),
  resumeTelemetry: vi.fn(async () => undefined),
  addTelemetryApp: vi.fn(async () => undefined),
}));

vi.mock('@/lib/tinybird/errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tinybird/errors')>()),
  getErrorActivity: vi.fn(async () => tinybird.activity),
  getReleaseErrorCounts: vi.fn(
    async (_appId: string, ids: string[]) =>
      new Map(
        ids.flatMap((id) =>
          tinybird.releaseErrors.has(id) ? [[id, tinybird.releaseErrors.get(id)!]] : [],
        ),
      ),
  ),
  getAppErrorUsage: vi.fn(async () => tinybird.usage),
  getErrorIssueReleases: vi.fn(async () => new Map(tinybird.issueReleases)),
  getReleaseCapableApplies: vi.fn(
    async (_appId: string, ids: string[]) =>
      new Map(ids.map((id) => [id, tinybird.applies.get(id) ?? 0])),
  ),
  listErrorGroups: vi.fn(async (filters: { fingerprints?: string[] }) => ({
    data: tinybird.groups.filter(
      (group) => !filters.fingerprints || filters.fingerprints.includes(group.fingerprint),
    ),
    available: true,
  })),
  getErrorGroupBuckets: vi.fn(async () => ({ data: new Map(), available: true })),
  getErrorGroupSamples: vi.fn(async () => ({ data: [], available: true })),
  getErrorGroupBreakdown: vi.fn(async () => ({
    data: { release: [], platform: [], os_version: [], native_build: [], channel: [], route: [] },
    available: true,
  })),
}));
vi.mock('@/lib/tinybird/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tinybird/events')>()),
  getReleaseEventCountsWithStatus: vi.fn(async (_appId: string, ids: string[]) => ({
    data: new Map(
      ids.map((id) => [
        id,
        { downloads: 0, applied: tinybird.applies.get(id) ?? 0, downloadErrors: 0, rollbacks: 0 },
      ]),
    ),
    available: true,
  })),
}));
vi.mock('@/lib/telemetry-gate', () => gate);

const { db } = await import('@/lib/db');
const { runErrorsCron } = await import('./errors-cron');
const issues = await import('./services/error-issues');

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

const NOW = new Date('2026-10-14T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

databaseDescribe('error tracking (PostgreSQL integration)', () => {
  let organizationId: string;
  let appId: string;
  let destinationId: string;

  function activity(fingerprint: string, overrides: Partial<ErrorActivity> = {}): ErrorActivity {
    return {
      appId,
      fingerprint,
      errorName: 'TypeError',
      normalizedMessage: 'x is undefined (reading <str>)',
      topFrame: 'computeTotal (assets/index.js)',
      firstReleaseId: null,
      firstSeenAt: minutesAgo(60),
      lastSeenAt: minutesAgo(1),
      lastOccurredAt: minutesAgo(1),
      events: 5,
      ...overrides,
    };
  }

  const deliveries = (type?: string) =>
    db.notificationDelivery.findMany({
      where: { destinationId, ...(type ? { eventType: type } : {}) },
      orderBy: { createdAt: 'asc' },
    });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('POLAR_ACCESS_TOKEN', '');
    tinybird.activity = [];
    tinybird.groups = [];
    tinybird.releaseErrors = new Map();
    tinybird.applies = new Map();
    tinybird.usage = new Map();
    tinybird.issueReleases = new Map();
    organizationId = randomUUID();
    appId = randomUUID();
    await db.organization.create({
      data: {
        id: organizationId,
        name: 'Errors',
        apps: { create: { id: appId, slug: `errors.${organizationId}` } },
      },
    });
    destinationId = (
      await db.notificationDestination.create({
        data: {
          organizationId,
          type: 'webhook',
          name: 'Errors hook',
          url: 'https://hooks.example/errors',
          events: ['errors.new_issue', 'errors.regression', 'errors.spike', 'errors.paused'],
        },
      })
    ).id;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.organization.delete({ where: { id: organizationId } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('creates issues for existing apps and keeps them in step', async () => {
    tinybird.activity = [
      activity('aaaaaaaaaaaaaaaa', { firstReleaseId: 'release-x', events: 2 }),
      activity('bbbbbbbbbbbbbbbb', { appId: randomUUID() }), // a deleted app
    ];
    const first = await runErrorsCron(NOW);
    expect(first).toMatchObject({ activeIssues: 1, created: 1, updated: 0, skipped: [] });
    expect(gate.replaceTelemetryApps).toHaveBeenCalledWith(expect.arrayContaining([appId]));

    tinybird.activity = [
      activity('aaaaaaaaaaaaaaaa', {
        firstReleaseId: 'release-y',
        firstSeenAt: minutesAgo(120),
        lastSeenAt: minutesAgo(0),
        events: 3,
      }),
    ];
    expect(await runErrorsCron(NOW)).toMatchObject({ created: 0, updated: 1 });
    const issue = await db.errorIssue.findUniqueOrThrow({
      where: { appId_fingerprint: { appId, fingerprint: 'aaaaaaaaaaaaaaaa' } },
    });
    expect(issue).toMatchObject({
      status: 'open',
      errorName: 'TypeError',
      firstReleaseId: 'release-x',
      firstSeenAt: minutesAgo(120),
      lastSeenAt: minutesAgo(0),
      eventCount: 3,
    });
    // Nothing changed: no writes.
    expect(await runErrorsCron(NOW)).toMatchObject({ created: 0, updated: 0 });
  });

  it('alerts a new issue once when it reaches 5 events within a day', async () => {
    tinybird.activity = [
      activity('aaaaaaaaaaaaaaaa', { events: 4 }),
      activity('cccccccccccccccc', { events: 50, firstSeenAt: minutesAgo(25 * 60) }),
    ];
    expect(await runErrorsCron(NOW)).toMatchObject({ newIssueAlerts: 0 });
    tinybird.activity = [activity('aaaaaaaaaaaaaaaa', { events: 5 })];
    expect(await runErrorsCron(NOW)).toMatchObject({ newIssueAlerts: 1, queued: 1 });
    expect(await runErrorsCron(NOW)).toMatchObject({ newIssueAlerts: 0, queued: 0 });
    const [delivery] = await deliveries('errors.new_issue');
    const payload = JSON.parse(delivery.payload);
    expect(payload.data.issue).toMatchObject({
      fingerprint: 'aaaaaaaaaaaaaaaa',
      title: 'TypeError: x is undefined (reading <str>)',
      events: 5,
      status: 'open',
    });
    expect(payload.data.dashboardUrl).toContain('&issue=aaaaaaaaaaaaaaaa');
    expect(payload.data.actor).toBeNull();
  });

  it('reopens a resolved issue that comes back, but not for a late retry', async () => {
    tinybird.activity = [activity('aaaaaaaaaaaaaaaa', { events: 1 })];
    await runErrorsCron(NOW);
    const actor = { actorType: 'user' as const, actorId: 'u1', actorLabel: 'dev@acme.test' };
    const resolvedAt = minutesAgo(30);
    await issues.setErrorIssueStatus(
      { organizationId, appId, actor },
      'aaaaaaaaaaaaaaaa',
      'resolved',
      resolvedAt,
    );

    // Received after the fix, but it happened before it: a retry from an offline device.
    tinybird.activity = [
      activity('aaaaaaaaaaaaaaaa', {
        lastSeenAt: minutesAgo(5),
        lastOccurredAt: minutesAgo(40),
        events: 2,
      }),
    ];
    expect(await runErrorsCron(NOW)).toMatchObject({ regressions: 0 });

    tinybird.activity = [
      activity('aaaaaaaaaaaaaaaa', {
        lastSeenAt: minutesAgo(1),
        lastOccurredAt: minutesAgo(2),
        events: 3,
      }),
    ];
    expect(await runErrorsCron(NOW)).toMatchObject({ regressions: 1, queued: 1 });
    expect(await runErrorsCron(NOW)).toMatchObject({ regressions: 0 });
    const issue = await db.errorIssue.findUniqueOrThrow({
      where: { appId_fingerprint: { appId, fingerprint: 'aaaaaaaaaaaaaaaa' } },
    });
    expect(issue).toMatchObject({
      status: 'open',
      resolvedAt: null,
      regressions: 1,
      statusChangedBy: 'error-tracking',
      eventCount: 3,
    });
    const [delivery] = await deliveries('errors.regression');
    expect(delivery.eventKey).toBe(`errors.regression:${issue.id}:1`);
    expect(JSON.parse(delivery.payload).data.previouslyResolvedAt).toBe(resolvedAt.toISOString());
    const audit = await db.auditLog.findMany({
      where: { organizationId, targetId: issue.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((entry) => [entry.action, entry.actorLabel])).toEqual([
      ['error_issue.resolved', 'dev@acme.test'],
      ['error_issue.regressed', 'error-tracking'],
    ]);
  });

  it('reopens only when the issue happens on a release it was not resolved with', async () => {
    tinybird.activity = [activity('aaaaaaaaaaaaaaaa', { events: 3 })];
    await runErrorsCron(NOW);
    const seen = { lastSeenAt: minutesAgo(40), lastOccurredAt: minutesAgo(40), events: 3 };
    tinybird.issueReleases = new Map([
      ['release-old', seen],
      ['', seen],
    ]);
    const actor = { actorType: 'user' as const, actorId: 'u1', actorLabel: 'dev@acme.test' };
    const resolvedAt = minutesAgo(30);
    await issues.setErrorIssueStatus(
      { organizationId, appId, actor },
      'aaaaaaaaaaaaaaaa',
      'resolved',
      resolvedAt,
    );
    expect(
      (
        await db.errorIssue.findUniqueOrThrow({
          where: { appId_fingerprint: { appId, fingerprint: 'aaaaaaaaaaaaaaaa' } },
        })
      ).resolvedReleaseIds.sort(),
    ).toEqual(['', 'release-old']);

    // Phones still on the old release and the built-in bundle keep reporting it.
    const later = { lastSeenAt: minutesAgo(2), lastOccurredAt: minutesAgo(2), events: 9 };
    tinybird.issueReleases = new Map([
      ['release-old', later],
      ['', later],
    ]);
    tinybird.activity = [activity('aaaaaaaaaaaaaaaa', { events: 9, lastSeenAt: minutesAgo(2) })];
    expect(await runErrorsCron(NOW)).toMatchObject({ regressions: 0, updated: 1 });

    // It shows up on the release with the fix.
    tinybird.issueReleases.set('release-fix', { ...later, events: 1 });
    tinybird.activity = [activity('aaaaaaaaaaaaaaaa', { events: 10, lastSeenAt: minutesAgo(1) })];
    expect(await runErrorsCron(NOW)).toMatchObject({ regressions: 1 });
    const issue = await db.errorIssue.findUniqueOrThrow({
      where: { appId_fingerprint: { appId, fingerprint: 'aaaaaaaaaaaaaaaa' } },
    });
    expect(issue).toMatchObject({ status: 'open', resolvedReleaseIds: [], regressions: 1 });
    const [delivery] = await deliveries('errors.regression');
    expect(JSON.parse(delivery.payload).data.release).toBeNull(); // not a release of this app
    const audit = await db.auditLog.findFirstOrThrow({
      where: { targetId: issue.id, action: 'error_issue.regressed' },
    });
    expect(audit.metadata).toEqual({
      appId,
      fingerprint: 'aaaaaaaaaaaaaaaa',
      resolvedAt: resolvedAt.toISOString(),
      releaseId: 'release-fix',
    });
  });

  it('keeps ignored issues quiet', async () => {
    tinybird.activity = [activity('aaaaaaaaaaaaaaaa', { events: 1 })];
    await runErrorsCron(NOW);
    const actor = { actorType: 'key' as const, actorId: 'k1', actorLabel: 'api-key:CI' };
    await issues.setErrorIssueStatus(
      { organizationId, appId, actor },
      'aaaaaaaaaaaaaaaa',
      'ignored',
    );
    tinybird.activity = [activity('aaaaaaaaaaaaaaaa', { events: 99, lastSeenAt: minutesAgo(0) })];
    expect(await runErrorsCron(NOW)).toMatchObject({
      newIssueAlerts: 0,
      regressions: 0,
      updated: 1,
    });
    expect(await deliveries()).toEqual([]);
  });

  it('alerts a release spike once against the previous release on its lane', async () => {
    const bundle = (version: string) =>
      db.bundle.create({
        data: {
          appId,
          version,
          sha256: version.padEnd(64, '0'),
          storageKey: `bundles/${appId}/${version}.zip`,
          size: 100,
          runtimeVersion: '1.0',
        },
      });
    const [oldBundle, newBundle] = [await bundle('1.0.0'), await bundle('1.1.0')];
    const previous = await db.release.create({
      data: {
        appId,
        bundleId: oldBundle.id,
        channel: 'production',
        promotedAt: minutesAgo(10 * 24 * 60),
      },
    });
    const current = await db.release.create({
      data: {
        appId,
        bundleId: newBundle.id,
        previousBundleId: oldBundle.id,
        channel: 'production',
        promotedAt: minutesAgo(24 * 60),
      },
    });
    tinybird.activity = [activity('aaaaaaaaaaaaaaaa', { events: 1 })];
    // A previous release without errors is no baseline: it may not have tracked them yet.
    tinybird.releaseErrors = new Map([
      [current.id, { events: 500, issues: 2 }],
      [previous.id, { events: 0, issues: 0 }],
    ]);
    tinybird.applies = new Map([
      [current.id, 1000],
      [previous.id, 1000],
    ]);
    expect(await runErrorsCron(NOW)).toMatchObject({ spikeAlerts: 0 });

    tinybird.releaseErrors = new Map([
      [current.id, { events: 29, issues: 2 }],
      [previous.id, { events: 10, issues: 1 }],
    ]);
    tinybird.applies = new Map([
      [current.id, 1000],
      [previous.id, 1000],
    ]);
    expect(await runErrorsCron(NOW)).toMatchObject({ spikeAlerts: 0 });

    tinybird.releaseErrors.set(current.id, { events: 30, issues: 2 });
    tinybird.activity = [activity('aaaaaaaaaaaaaaaa', { events: 2, lastSeenAt: minutesAgo(0) })];
    expect(await runErrorsCron(NOW)).toMatchObject({ spikeAlerts: 1 });
    tinybird.activity = [activity('aaaaaaaaaaaaaaaa', { events: 3, lastSeenAt: NOW })];
    expect(await runErrorsCron(NOW)).toMatchObject({ spikeAlerts: 0 });

    const [delivery] = await deliveries('errors.spike');
    expect(delivery.eventKey).toBe(`errors.spike:${current.id}`);
    const data = JSON.parse(delivery.payload).data;
    expect(data.release).toMatchObject({ id: current.id, bundleVersion: '1.1.0' });
    expect(data.previousRelease).toMatchObject({ id: previous.id, bundleVersion: '1.0.0' });
    expect(data.errors).toEqual({
      events: 30,
      applies: 1000,
      perThousandApplies: 30,
      previousEvents: 10,
      previousApplies: 1000,
      previousPerThousandApplies: 10,
      issues: 2,
    });
  });

  it('pauses a workspace at its monthly cap and resumes it below', async () => {
    vi.stubEnv('POLAR_ACCESS_TOKEN', 'polar-test');
    const monthEnd = new Date('2026-11-01T00:00:00.000Z');
    tinybird.usage = new Map([[appId, 10_000]]);
    expect(await runErrorsCron(NOW)).toMatchObject({ paused: 1, queued: 1 });
    expect(gate.pauseTelemetry).toHaveBeenCalledWith('error', [appId], monthEnd);
    expect(
      (await db.organization.findUniqueOrThrow({ where: { id: organizationId } }))
        .errorsPausedUntil,
    ).toEqual(monthEnd);
    // Still over: keys are refreshed (new apps), the alert is not repeated.
    expect(await runErrorsCron(NOW)).toMatchObject({ paused: 0, queued: 0 });
    expect(gate.pauseTelemetry).toHaveBeenCalledTimes(2);
    const status = await issues.getErrorTrackingStatus(organizationId, NOW);
    expect(status).toMatchObject({ limit: 10_000, pausedUntil: monthEnd.toISOString() });

    // Upgraded to Starter: below the new limit, so it resumes.
    await db.organization.update({ where: { id: organizationId }, data: { planKey: 'starter' } });
    expect(await runErrorsCron(NOW)).toMatchObject({ resumed: 1 });
    expect(gate.resumeTelemetry).toHaveBeenCalledWith('error', [appId]);
    expect(
      (await db.organization.findUniqueOrThrow({ where: { id: organizationId } }))
        .errorsPausedUntil,
    ).toBeNull();
    const [delivery] = await deliveries('errors.paused');
    expect(JSON.parse(delivery.payload).data).toMatchObject({
      app: null,
      errorUsage: { events: 10_000, limit: 10_000, pausedUntil: monthEnd.toISOString() },
    });
  });

  it('lifts a pause on servers without billing', async () => {
    await db.organization.update({
      where: { id: organizationId },
      data: { errorsPausedUntil: new Date('2026-11-01T00:00:00.000Z') },
    });
    expect(await runErrorsCron(NOW)).toMatchObject({ resumed: 1 });
  });

  it('lists issues with their state and filters by status', async () => {
    const group = (fingerprint: string, events: number): ErrorGroup => ({
      fingerprint,
      errorName: 'Error',
      normalizedMessage: `failed ${fingerprint.slice(0, 1)}`,
      topFrame: null,
      lastMessage: 'failed',
      events,
      sessions: 1,
      releases: 1,
      handled: false,
      platforms: ['ios'],
      firstSeenAt: minutesAgo(60).toISOString(),
      lastSeenAt: minutesAgo(1).toISOString(),
    });
    tinybird.groups = [group('aaaaaaaaaaaaaaaa', 9), group('bbbbbbbbbbbbbbbb', 3)];
    const actor = { actorType: 'user' as const, actorId: 'u1', actorLabel: 'dev@acme.test' };
    // Not synced yet: the status change creates its row from the raw errors.
    const change = await issues.setErrorIssueStatus(
      { organizationId, appId, actor },
      'bbbbbbbbbbbbbbbb',
      'resolved',
      NOW,
    );
    expect(change).toMatchObject({
      status: 'resolved',
      previousStatus: 'open',
      resolvedAt: NOW.toISOString(),
      statusChangedBy: 'dev@acme.test',
      title: 'Error: failed b',
    });

    const list = (status: 'open' | 'resolved' | 'all') =>
      issues.listErrorIssues({ organizationId, appId }, { status }, NOW);
    expect((await list('open')).issues.map((issue) => issue.fingerprint)).toEqual([
      'aaaaaaaaaaaaaaaa',
    ]);
    expect((await list('resolved')).issues).toMatchObject([
      { fingerprint: 'bbbbbbbbbbbbbbbb', status: 'resolved', events: 3 },
    ]);
    const all = await list('all');
    expect(all).toMatchObject({ total: 2, truncated: false, analyticsAvailable: true });
    expect(all.issues[0]).toMatchObject({
      fingerprint: 'aaaaaaaaaaaaaaaa',
      status: 'open',
      title: 'Error: failed a',
      isNew: true,
    });

    await expect(
      issues.getErrorIssue({ organizationId, appId }, 'ffffffffffffffff', {}, NOW),
    ).rejects.toMatchObject({ code: 'ERROR_ISSUE_NOT_FOUND', status: 404 });
    await expect(
      issues.setErrorIssueStatus({ organizationId, appId, actor }, 'nope', 'resolved'),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      issues.listErrorIssues({ organizationId, appId: randomUUID() }, {}, NOW),
    ).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
  });

  it('summarizes errors per release, with issues first seen in it', async () => {
    tinybird.activity = [
      activity('aaaaaaaaaaaaaaaa', { firstReleaseId: 'release-a' }),
      activity('bbbbbbbbbbbbbbbb', { firstReleaseId: 'release-a' }),
      activity('cccccccccccccccc', { firstReleaseId: 'release-b' }),
    ];
    await runErrorsCron(NOW);
    tinybird.releaseErrors = new Map([['release-a', { events: 18, issues: 3 }]]);
    tinybird.applies = new Map([['release-a', 10_000]]);
    const summaries = await issues.getReleaseErrorSummaries(appId, ['release-a', 'release-c']);
    expect(summaries?.get('release-a')).toEqual({
      events: 18,
      issues: 3,
      newIssues: 2,
      applies: 10_000,
      perThousandApplies: 1.8,
    });
    expect(summaries?.get('release-c')).toEqual({
      events: 0,
      issues: 0,
      newIssues: 0,
      applies: 0,
      perThousandApplies: null,
    });
  });
});
