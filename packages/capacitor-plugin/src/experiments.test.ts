import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppTelemetryItem, ExperimentContext, NativeRemoteConfig } from './definitions';
import { assignVariant, createExperiments, parseExperiments } from './experiments';
import { createTelemetry } from './telemetry';

const EXP_A = '0b1d2c3e-0000-4000-8000-00000000000a';
const EXP_B = '0b1d2c3e-0000-4000-8000-00000000000b';
const EXP_CODE = '0b1d2c3e-0000-4000-8000-00000000000c';

const paywall = {
  id: EXP_A,
  key: 'paywall_copy',
  traffic: 100,
  variants: [
    { key: 'control', weight: 50, overrides: {} },
    { key: 'b', weight: 50, overrides: { paywallTitle: 'Unlock everything', color: 'red' } },
  ],
  goals: ['purchase_completed', 'signup'],
  channels: null,
  runtimeVersions: null,
};
const colors = {
  id: EXP_B,
  key: 'button_color',
  traffic: 50,
  variants: [
    { key: 'control', weight: 34, overrides: {} },
    { key: 'green', weight: 33, overrides: { color: 'green' } },
    { key: 'blue', weight: 33, overrides: { color: 'blue' } },
  ],
  goals: ['purchase_completed'],
  channels: ['production', null],
  runtimeVersions: ['1'],
};
const onboarding = {
  id: EXP_CODE,
  key: 'new_onboarding',
  traffic: 100,
  variants: [
    { key: 'control', weight: 50, overrides: {} },
    { key: 'b', weight: 50, overrides: {} },
  ],
  goals: ['onboarding_done'],
  channels: null,
  runtimeVersions: null,
};

function config(experiments: unknown[] | null, values = { paywallTitle: 'Go Pro', color: 'grey' }) {
  return {
    valuesJson: JSON.stringify(values),
    experimentsJson: experiments ? JSON.stringify(experiments) : null,
    version: 3,
    channel: null,
    fetchedAt: '2026-10-14T09:00:00.000Z',
    source: 'remote',
  } satisfies NativeRemoteConfig;
}

function setup(
  options: {
    experiments?: unknown[] | null;
    buckets?: ExperimentContext['buckets'];
    deviceChannel?: string | null;
    runtimeVersion?: string | null;
    reported?: Record<string, string[]>;
    native?: boolean;
  } = {},
) {
  let ids = 0;
  const flags = new Map<string, Set<string>>(
    Object.entries(options.reported ?? {}).map(([id, reports]) => [id, new Set(reports)]),
  );
  const stored: Array<{ experimentId: string; report: string; item: AppTelemetryItem }> = [];
  const native = {
    getConfig: vi.fn(async () => config(options.experiments ?? [paywall, colors, onboarding])),
    getExperimentContext: vi.fn(async ({ experimentIds }: { experimentIds: string[] }) => ({
      deviceChannel: options.deviceChannel === undefined ? 'production' : options.deviceChannel,
      runtimeVersion: options.runtimeVersion === undefined ? '1' : options.runtimeVersion,
      buckets: Object.fromEntries(
        experimentIds.map((id) => [id, options.buckets?.[id] ?? { traffic: 10, variant: 80 }]),
      ),
      reported: Object.fromEntries([...flags].map(([id, set]) => [id, [...set]])),
    })),
    reportExperiment: vi.fn(
      async (call: {
        experimentId: string;
        report: string;
        requires?: 'exposure';
        item: AppTelemetryItem;
      }) => {
        const set = flags.get(call.experimentId) ?? new Set<string>();
        if (set.has(call.report)) return { reported: false };
        if (call.requires && !set.has(call.requires)) return { reported: false };
        set.add(call.report);
        flags.set(call.experimentId, set);
        stored.push({ experimentId: call.experimentId, report: call.report, item: call.item });
        return { reported: true };
      },
    ),
    enqueueAppTelemetry: vi.fn(async () => ({ accepted: 1, dropped: 0 })),
    getState: vi.fn(async () => ({ current: { id: 'builtin', version: '1.0' } })),
  };
  const telemetry = createTelemetry(native as never, {
    isNative: () => options.native ?? true,
    target: null,
    document: null,
    location: () => null,
    random: () => 0,
    uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
  });
  const experiments = createExperiments(native as never, telemetry);
  const reports = () => stored.map((entry) => `${entry.experimentId.slice(-1)}:${entry.report}`);
  return { experiments, native, stored, reports, flags };
}

/** Let queued reports run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseExperiments', () => {
  it('keeps valid experiments and skips anything off', () => {
    expect(parseExperiments(JSON.stringify([paywall, colors])).map((item) => item.key)).toEqual([
      'paywall_copy',
      'button_color',
    ]);
    const broken = [
      { ...paywall, id: 'not-a-uuid' },
      {
        ...paywall,
        id: EXP_B,
        variants: [{ key: 'control', weight: 60, overrides: {} }, paywall.variants[1]],
      },
      { ...paywall, id: EXP_CODE, key: 'Bad Key' },
      { ...colors, goals: ['.'] },
      { ...onboarding, channels: [1] },
      { ...onboarding, id: EXP_A, key: 'paywall_copy' },
      onboarding,
      // Keys and IDs are unique: the first one wins.
      { ...onboarding, id: EXP_B },
      { ...colors, id: EXP_CODE },
      'text',
    ];
    expect(parseExperiments(JSON.stringify(broken)).map((item) => item.key)).toEqual([
      'paywall_copy',
      'new_onboarding',
    ]);
    expect(parseExperiments('{"not":"a list"}')).toEqual([]);
    expect(parseExperiments('[')).toEqual([]);
    expect(parseExperiments(null)).toEqual([]);
  });
});

describe('assignVariant', () => {
  const [definition] = parseExperiments(JSON.stringify([colors]));
  const context = (traffic: number, variant: number, more: Partial<ExperimentContext> = {}) => ({
    deviceChannel: 'production',
    runtimeVersion: '1',
    buckets: { [EXP_B]: { traffic, variant } },
    ...more,
  });

  it('uses the traffic bucket, then cumulative weights', () => {
    expect(assignVariant(definition, context(50, 34))).toBe('control');
    expect(assignVariant(definition, context(1, 35))).toBe('green');
    expect(assignVariant(definition, context(50, 67))).toBe('green');
    expect(assignVariant(definition, context(50, 68))).toBe('blue');
    expect(assignVariant(definition, context(50, 100))).toBe('blue');
    expect(assignVariant(definition, context(51, 1))).toBeNull();
  });

  it('checks the channel (null = base) and runtime version', () => {
    expect(assignVariant(definition, context(1, 1, { deviceChannel: null }))).toBe('control');
    expect(assignVariant(definition, context(1, 1, { deviceChannel: 'staging' }))).toBeNull();
    expect(assignVariant(definition, context(1, 1, { runtimeVersion: '2' }))).toBeNull();
    expect(assignVariant(definition, context(1, 1, { runtimeVersion: null }))).toBeNull();
    expect(assignVariant(definition, { ...context(1, 1), buckets: {} })).toBeNull();
  });
});

describe('createExperiments', () => {
  it('applies the device variants in order and reports exposure once', async () => {
    const { experiments, reports, native, stored } = setup({
      buckets: { [EXP_A]: { traffic: 3, variant: 51 }, [EXP_B]: { traffic: 7, variant: 99 } },
    });
    const values = { paywallTitle: 'Go Pro', color: 'grey', other: 1 };
    const result = await experiments.applyToConfig(config([paywall, colors]), values);
    // paywall_copy is b, button_color is blue: the later experiment wins on `color`.
    expect(result).toEqual({ paywallTitle: 'Unlock everything', color: 'blue', other: 1 });
    expect(values.color).toBe('grey');
    await experiments.applyToConfig(config([paywall, colors]), values);
    await settle();
    expect(reports()).toEqual(['a:exposure', 'b:exposure']);
    expect(native.getExperimentContext).toHaveBeenCalledTimes(2);
    expect(stored[0].item).toEqual({
      kind: 'event',
      eventId: '00000000-0000-4000-8000-000000000001',
      occurredAt: '2026-10-14T12:00:00.000Z',
      name: '$exposure',
      properties: { experiment: EXP_A, variant: 'b' },
    });
  });

  it('gives control and devices outside the traffic the normal values', async () => {
    const { experiments, reports } = setup({
      buckets: { [EXP_A]: { traffic: 3, variant: 50 }, [EXP_B]: { traffic: 51, variant: 99 } },
    });
    const result = await experiments.applyToConfig(config([paywall, colors]), { color: 'grey' });
    expect(result).toEqual({ color: 'grey' });
    await settle();
    // Control is exposed too; the device outside button_color's traffic is not.
    expect(reports()).toEqual(['a:exposure']);
  });

  it('exposes code-only experiments through getVariant only', async () => {
    const { experiments, reports } = setup({
      buckets: { [EXP_CODE]: { traffic: 1, variant: 77 } },
    });
    await experiments.applyToConfig(config([onboarding]), {});
    await settle();
    expect(reports()).toEqual([]);
    await expect(experiments.getVariant('new_onboarding')).resolves.toBe('b');
    await expect(experiments.getVariant('new_onboarding')).resolves.toBe('b');
    await expect(experiments.getVariant('missing')).resolves.toBeNull();
    await settle();
    expect(reports()).toEqual(['c:exposure']);
  });

  it('reports each goal once, only after the exposure', async () => {
    const { experiments, reports, stored } = setup({
      buckets: { [EXP_A]: { traffic: 1, variant: 10 } },
      experiments: [paywall],
    });
    // Before any exposure the goal does not count.
    experiments.onEvent('purchase_completed');
    await settle();
    expect(reports()).toEqual([]);
    // getConfig, then the goal right away: the exposure is stored first.
    await experiments.applyToConfig(config([paywall]), {});
    experiments.onEvent('purchase_completed');
    experiments.onEvent('purchase_completed');
    experiments.onEvent('signup');
    experiments.onEvent('other_event');
    await settle();
    expect(reports()).toEqual([
      'a:exposure',
      'a:conversion:purchase_completed',
      'a:conversion:signup',
    ]);
    expect(stored[1].item).toMatchObject({
      name: '$conversion',
      properties: { experiment: EXP_A, variant: 'control', goal: 'purchase_completed' },
    });
  });

  it('reports the first error after the exposure', async () => {
    const { experiments, reports, stored } = setup({
      buckets: { [EXP_A]: { traffic: 1, variant: 90 } },
      experiments: [paywall],
    });
    await experiments.getVariant('paywall_copy');
    experiments.onError();
    experiments.onError();
    await settle();
    expect(reports()).toEqual(['a:exposure', 'a:error']);
    expect(stored[1].item).toMatchObject({
      name: '$experiment_error',
      properties: { experiment: EXP_A, variant: 'b' },
    });
  });

  it('does not ask native again for what the device already reported', async () => {
    const { experiments, native } = setup({
      experiments: [paywall],
      reported: { [EXP_A]: ['exposure', 'conversion:purchase_completed'] },
    });
    await experiments.getVariant('paywall_copy');
    experiments.onEvent('purchase_completed');
    await settle();
    expect(native.reportExperiment).not.toHaveBeenCalled();
  });

  it('fails closed without the native methods, and does nothing on web', async () => {
    const { experiments, native } = setup({ experiments: [paywall] });
    native.getExperimentContext.mockRejectedValue(
      Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' }),
    );
    await expect(experiments.applyToConfig(config([paywall]), { a: 1 })).resolves.toEqual({ a: 1 });
    await expect(experiments.getVariant('paywall_copy')).resolves.toBeNull();
    expect(native.getExperimentContext).toHaveBeenCalledTimes(1);

    const web = setup({ native: false });
    web.experiments.onEvent('purchase_completed');
    web.experiments.onError();
    await settle();
    expect(web.native.getConfig).not.toHaveBeenCalled();
  });

  it('ignores config without experiments and saved config files', async () => {
    const { experiments, native } = setup();
    await expect(experiments.applyToConfig(config(null), { a: 1 })).resolves.toEqual({ a: 1 });
    await expect(
      experiments.applyToConfig({ ...config([paywall]), source: 'none' }, { a: 1 }),
    ).resolves.toEqual({ a: 1 });
    expect(native.getExperimentContext).not.toHaveBeenCalled();
  });
});
