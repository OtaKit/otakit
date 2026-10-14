import crypto, { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEventNameCounts } from '@/lib/tinybird/app-events';
import type { ExperimentReportRow } from '@/lib/tinybird/experiments';

const files = vi.hoisted(() => new Map<string, string>());
const reports = vi.hoisted(() => ({
  totals: [] as ExperimentReportRow[],
  daily: [] as ExperimentReportRow[],
  available: true,
  calls: [] as Array<Record<string, unknown>>,
}));
const names = vi.hoisted(() => ({ rows: new Map<string, AppEventNameCounts>() }));

vi.mock('@/lib/storage', () => ({
  buildPublicObjectUrl: (key: string) => `https://cdn.test/${key}`,
  putTextObject: vi.fn(async (args: { storageKey: string; body: string }) => {
    files.set(args.storageKey, args.body);
  }),
  deleteStorageObject: vi.fn(async (key: string) => {
    files.delete(key);
  }),
}));
vi.mock('@/lib/cdn-purge', () => ({ purgeCdnUrls: vi.fn() }));
vi.mock('@/lib/tinybird/experiments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tinybird/experiments')>()),
  getExperimentReports: vi.fn(async (input: Record<string, unknown>) => {
    reports.calls.push(input);
    return { data: input.daily ? reports.daily : reports.totals, available: reports.available };
  }),
}));
vi.mock('@/lib/tinybird/app-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tinybird/app-events')>()),
  listAppEventNames: vi.fn(async (filters: { name?: string }) => ({
    data: filters.name && names.rows.has(filters.name) ? [names.rows.get(filters.name)!] : [],
    available: true,
  })),
  getAppEventUsage: vi.fn(async () => new Map()),
}));

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
vi.stubEnv('MANIFEST_SIGNING_DISABLED', '');
vi.stubEnv('MANIFEST_SIGNING_KID', 'experiments-kid');
vi.stubEnv('MANIFEST_SIGNING_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);

const { db } = await import('@/lib/db');
const experiments = await import('./experiments');
const remoteConfig = await import('./remote-config');

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

type ConfigFileJson = {
  version: number;
  valuesJson: string;
  experimentsJson: string | null;
};

const paywall = (overrides: Record<string, unknown> = {}) => ({
  key: 'paywall_copy',
  name: 'Paywall copy',
  variants: [
    { key: 'control', weight: 50, overrides: {} },
    { key: 'b', weight: 50, overrides: { paywallTitle: 'Unlock everything' } },
  ],
  goalEvent: 'purchase_completed',
  secondaryEvents: ['signup'],
  ...overrides,
});

const row = (variant: string, name: string, reportsCount: number, goal = '', day?: string) =>
  ({ day: day ?? null, variant, name, goal, reports: reportsCount }) satisfies ExperimentReportRow;

databaseDescribe('A/B tests (PostgreSQL integration)', () => {
  let organizationId: string;
  let appId: string;
  const actor = { actorType: 'user' as const, actorId: 'exp-user', actorLabel: 'dev@acme.test' };
  const context = () => ({ organizationId, appId, actor });
  const fileOf = (channel: string | null) => {
    const body = files.get(`config/${appId}/${channel ?? '__base__'}/config.json`);
    return body ? (JSON.parse(body) as ConfigFileJson) : null;
  };
  const deviceExperiments = (channel: string | null) =>
    JSON.parse(fileOf(channel)?.experimentsJson ?? 'null') as Array<{ key: string }> | null;
  const deliveries = async (type: string) =>
    db.notificationDelivery.count({ where: { eventType: type, destination: { organizationId } } });

  beforeEach(async () => {
    files.clear();
    reports.totals = [];
    reports.daily = [];
    reports.available = true;
    reports.calls = [];
    names.rows = new Map();
    vi.stubEnv('POLAR_ACCESS_TOKEN', '');
    organizationId = randomUUID();
    appId = randomUUID();
    await db.organization.create({
      data: {
        id: organizationId,
        name: 'Experiments',
        apps: { create: { id: appId, slug: `experiments.${organizationId}` } },
      },
    });
    await db.notificationDestination.create({
      data: {
        organizationId,
        type: 'webhook',
        name: 'Experiments hook',
        url: 'https://hooks.example/experiments',
        events: [
          'experiment.started',
          'experiment.stopped',
          'experiment.verdict_reached',
          'config.updated',
        ],
      },
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('MANIFEST_SIGNING_DISABLED', '');
    vi.stubEnv('MANIFEST_SIGNING_KID', 'experiments-kid');
    vi.stubEnv(
      'MANIFEST_SIGNING_KEY',
      privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    );
    await db.organization.delete({ where: { id: organizationId } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('creates drafts with unique keys and edits them freely', async () => {
    const draft = await experiments.createExperiment(context(), paywall());
    expect(draft).toMatchObject({
      key: 'paywall_copy',
      status: 'draft',
      channel: null,
      audienceChannels: null,
      trafficPercent: 100,
      overriddenKeys: ['paywallTitle'],
      createdBy: 'dev@acme.test',
    });
    await expect(experiments.createExperiment(context(), paywall())).rejects.toMatchObject({
      code: 'EXPERIMENT_KEY_TAKEN',
      status: 409,
    });
    await expect(
      experiments.createExperiment(context(), paywall({ key: 'x', variants: [] })),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const edited = await experiments.updateExperiment(context(), 'paywall_copy', {
      trafficPercent: 40,
      audienceChannels: ['production', null],
    });
    expect(edited).toMatchObject({ trafficPercent: 40, audienceChannels: ['production', null] });
    const cleared = await experiments.updateExperiment(context(), draft.id, {
      audienceChannels: null,
    });
    expect(cleared.audienceChannels).toBeNull();
    expect(files.size).toBe(0);
    expect(
      await db.auditLog.count({ where: { organizationId, action: 'experiment.created' } }),
    ).toBe(1);
  });

  it('starts on the base config, even without one, and locks the test', async () => {
    const draft = await experiments.createExperiment(context(), paywall());
    const started = await experiments.startExperiment(context(), draft.id);
    expect(started).toMatchObject({
      experiment: { status: 'running' },
      configVersion: 1,
      publicationStatus: 'published',
    });
    expect(started.experiment.startedAt).not.toBeNull();
    const file = fileOf(null)!;
    expect(file).toMatchObject({ version: 1, valuesJson: '{}' });
    expect(JSON.parse(file.experimentsJson!)).toEqual([
      {
        id: draft.id,
        key: 'paywall_copy',
        traffic: 100,
        variants: paywall().variants,
        goals: ['purchase_completed', 'signup'],
        channels: null,
        runtimeVersions: null,
      },
    ]);
    expect(await deliveries('experiment.started')).toBe(1);
    // Values only change with the name; the rest is locked while it runs.
    await expect(
      experiments.updateExperiment(context(), draft.id, { trafficPercent: 50 }),
    ).rejects.toMatchObject({ code: 'EXPERIMENT_STATE' });
    expect(
      (await experiments.updateExperiment(context(), draft.id, { name: 'Paywall title' })).name,
    ).toBe('Paywall title');
    await expect(experiments.startExperiment(context(), draft.id)).rejects.toMatchObject({
      code: 'EXPERIMENT_STATE',
    });
    await expect(experiments.deleteExperiment(context(), draft.id)).rejects.toMatchObject({
      code: 'EXPERIMENT_STATE',
    });
    // Config writes keep the experiments; deleting the config is refused while it runs.
    await remoteConfig.publishRemoteConfig(context(), {
      channel: null,
      values: { paywallTitle: 'Go Pro' },
      expectedVersion: 1,
    });
    expect(fileOf(null)).toMatchObject({ version: 2, valuesJson: '{"paywallTitle":"Go Pro"}' });
    expect(deviceExperiments(null)?.map((item) => item.key)).toEqual(['paywall_copy']);
    await expect(
      remoteConfig.deleteRemoteConfig(context(), { channel: null, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: 'CONFIG_HAS_EXPERIMENTS', status: 409 });
  });

  it('needs a channel config of its own, and one key per running test', async () => {
    const onProduction = await experiments.createExperiment(
      context(),
      paywall({ channel: 'production' }),
    );
    await expect(experiments.startExperiment(context(), onProduction.id)).rejects.toMatchObject({
      code: 'CONFIG_REQUIRED',
    });
    await remoteConfig.publishRemoteConfig(context(), {
      channel: 'production',
      values: { paywallTitle: 'Go Pro', color: 'grey' },
      expectedVersion: 0,
    });
    await experiments.startExperiment(context(), onProduction.id);
    const sameKey = await experiments.createExperiment(context(), {
      ...paywall({ key: 'title_again', channel: 'production' }),
    });
    await expect(experiments.startExperiment(context(), sameKey.id)).rejects.toMatchObject({
      code: 'EXPERIMENT_CONFLICT',
      message: expect.stringContaining('"paywallTitle"'),
    });
    const color = await experiments.createExperiment(context(), {
      ...paywall({
        key: 'button_color',
        channel: 'production',
        variants: [
          { key: 'control', weight: 34, overrides: {} },
          { key: 'green', weight: 33, overrides: { color: 'green' } },
          { key: 'blue', weight: 33, overrides: { color: 'blue' } },
        ],
      }),
    });
    await experiments.startExperiment(context(), color.id);
    expect(deviceExperiments('production')?.map((item) => item.key)).toEqual([
      'paywall_copy',
      'button_color',
    ]);
    // The base config is untouched.
    expect(fileOf(null)).toBeNull();
  });

  it('stops and ships, writing the config once per change', async () => {
    await remoteConfig.publishRemoteConfig(context(), {
      channel: null,
      values: { paywallTitle: 'Go Pro', other: 1 },
      expectedVersion: 0,
    });
    const first = await experiments.createExperiment(context(), paywall());
    await experiments.startExperiment(context(), first.id);
    const stopped = await experiments.stopExperiment(context(), 'paywall_copy');
    expect(stopped).toMatchObject({ experiment: { status: 'stopped' }, configVersion: 3 });
    expect(fileOf(null)).toMatchObject({ version: 3, experimentsJson: null });
    expect(await deliveries('experiment.stopped')).toBe(1);
    await expect(
      experiments.shipExperimentVariant(context(), first.id, { variant: 'z' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    const shipped = await experiments.shipExperimentVariant(context(), first.id, { variant: 'b' });
    expect(shipped).toMatchObject({
      experiment: { status: 'shipped', shippedVariant: 'b' },
      configVersion: 4,
      changedKeys: ['paywallTitle'],
    });
    expect(fileOf(null)).toMatchObject({
      version: 4,
      valuesJson: '{"paywallTitle":"Unlock everything","other":1}',
      experimentsJson: null,
    });
    expect(await deliveries('config.updated')).toBe(2);
    const history = await remoteConfig.getRemoteConfigHistory({
      organizationId,
      appId,
      channel: null,
    });
    expect(history.map((entry) => entry.message)).toEqual([
      'Shipped b of A/B test paywall_copy',
      'Stopped A/B test paywall_copy',
      'Started A/B test paywall_copy',
      null,
    ]);
    await expect(
      experiments.shipExperimentVariant(context(), first.id, { variant: 'b' }),
    ).rejects.toMatchObject({ code: 'EXPERIMENT_STATE' });

    // The key is free again; shipping control of a running test only removes it.
    const again = await experiments.createExperiment(context(), paywall());
    await experiments.startExperiment(context(), again.id);
    const control = await experiments.shipExperimentVariant(context(), 'paywall_copy', {
      variant: 'control',
    });
    expect(control).toMatchObject({ configVersion: 6, changedKeys: [] });
    expect(fileOf(null)).toMatchObject({
      valuesJson: '{"paywallTitle":"Unlock everything","other":1}',
      experimentsJson: null,
    });
    expect(
      (await experiments.listExperiments({ organizationId, appId })).map((item) => [
        item.key,
        item.status,
      ]),
    ).toEqual([
      ['paywall_copy', 'shipped'],
      ['paywall_copy', 'shipped'],
    ]);
    // By key, the latest test that ended.
    expect((await experiments.getExperiment({ organizationId, appId }, 'paywall_copy')).id).toBe(
      again.id,
    );
    await experiments.deleteExperiment(context(), first.id);
  });

  it('applies the plan limit on running tests', async () => {
    vi.stubEnv('POLAR_ACCESS_TOKEN', 'polar-test-token');
    const first = await experiments.createExperiment(context(), paywall());
    await expect(experiments.startExperiment(context(), first.id)).rejects.toMatchObject({
      code: 'PLAN_REQUIRED',
      status: 403,
    });
    await db.organization.update({ where: { id: organizationId }, data: { planKey: 'starter' } });
    await experiments.startExperiment(context(), first.id);
    const second = await experiments.createExperiment(
      context(),
      paywall({
        key: 'other',
        variants: [
          { key: 'control', weight: 50, overrides: {} },
          { key: 'b', weight: 50, overrides: {} },
        ],
      }),
    );
    await expect(experiments.startExperiment(context(), second.id)).rejects.toMatchObject({
      code: 'EXPERIMENT_LIMIT_REACHED',
    });
  });

  it('computes results, a verdict and a cumulative series', async () => {
    const draft = await experiments.createExperiment(context(), paywall());
    const before = await experiments.getExperimentResults({ organizationId, appId }, draft.id);
    expect(before).toMatchObject({ stats: null, series: [] });
    await experiments.startExperiment(context(), draft.id);
    await db.experiment.update({
      where: { id: draft.id },
      data: { startedAt: new Date('2026-10-01T10:00:00.000Z') },
    });
    reports.totals = [
      row('control', '$exposure', 1000),
      row('control', '$conversion', 100, 'purchase_completed'),
      row('control', '$conversion', 300, 'signup'),
      row('b', '$exposure', 1000),
      row('b', '$conversion', 130, 'purchase_completed'),
      row('b', '$conversion', 280, 'signup'),
      row('b', '$experiment_error', 4),
      // Unknown variants and goals are ignored.
      row('z', '$exposure', 999),
      row('b', '$conversion', 50, 'other_goal'),
    ];
    reports.daily = [
      row('control', '$exposure', 600, '', '2026-10-01'),
      row('b', '$exposure', 590, '', '2026-10-01'),
      row('control', '$exposure', 400, '', '2026-10-03'),
      row('b', '$conversion', 130, 'purchase_completed', '2026-10-03'),
    ];
    const now = new Date('2026-10-11T10:00:00.000Z');
    const results = await experiments.getExperimentResults(
      { organizationId, appId },
      draft.id,
      now,
    );
    expect(results.daysRunning).toBe(10);
    expect(reports.calls.at(-1)).toMatchObject({ fromDay: '2026-10-01', toDay: '2026-10-11' });
    expect(
      results.stats!.variants.map((variant) => [variant.key, variant.exposed, variant.converted]),
    ).toEqual([
      ['control', 1000, 100],
      ['b', 1000, 130],
    ]);
    expect(results.stats!.variants[1].secondary.signup).toMatchObject({ converted: 280 });
    expect(results.stats!.verdict).toMatchObject({ kind: 'winner', variant: 'b' });
    expect(results.series).toHaveLength(11);
    expect(results.series[2]).toEqual({
      day: '2026-10-03',
      variants: [
        { key: 'control', exposed: 1000, converted: 0 },
        { key: 'b', exposed: 590, converted: 130 },
      ],
    });

    // The cron sends the verdict once, and nothing after the test stops.
    expect(await experiments.checkExperimentVerdicts(now)).toEqual({ checked: 1, notified: 1 });
    expect(
      await experiments.checkExperimentVerdicts(new Date(now.getTime() + 2 * 3_600_000)),
    ).toEqual({
      checked: 1,
      notified: 0,
    });
    expect(
      await experiments.checkExperimentVerdicts(new Date(now.getTime() + 2 * 3_600_000)),
    ).toEqual({
      checked: 0,
      notified: 0,
    });
    const delivery = await db.notificationDelivery.findFirstOrThrow({
      where: { eventType: 'experiment.verdict_reached', destination: { organizationId } },
    });
    expect(JSON.parse(delivery.payload)).toMatchObject({
      data: {
        experiment: { key: 'paywall_copy', status: 'running' },
        verdict: { kind: 'winner', variant: 'b' },
        variants: [{ key: 'control', exposed: 1000, converted: 100, rate: 0.1 }, { key: 'b' }],
      },
    });
    await experiments.stopExperiment(context(), draft.id);
    expect(
      await experiments.checkExperimentVerdicts(new Date(now.getTime() + 10 * 3_600_000)),
    ).toEqual({ checked: 0, notified: 0 });
  });

  it('estimates the sample from the last 14 days', async () => {
    names.rows = new Map([
      [
        '$session_start',
        {
          name: '$session_start',
          events: 14_100,
          sessions: 14_000,
          comparedEvents: 0,
          previousEvents: 0,
        },
      ],
      [
        'purchase_completed',
        {
          name: 'purchase_completed',
          events: 900,
          sessions: 700,
          comparedEvents: 0,
          previousEvents: 0,
        },
      ],
    ]);
    const estimate = await experiments.estimateExperiment(
      { organizationId, appId },
      { goalEvent: 'purchase_completed' },
    );
    expect(estimate).toEqual({
      launchesPerDay: 1000,
      goalShare: 0.05,
      plannedPerVariant: expect.any(Number),
      analyticsAvailable: true,
    });
    expect(estimate.plannedPerVariant).toBeGreaterThan(8000);
    await expect(
      experiments.estimateExperiment({ organizationId, appId }, { goalEvent: '$session_start' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
