import { describe, expect, it } from 'vitest';

import {
  buildExperimentsJson,
  overriddenKeys,
  sharedOverrideKeys,
  validateExperimentDefinition,
} from './experiments';

const valid = () => ({
  key: 'paywall_copy',
  name: '  Paywall   copy ',
  variants: [
    { key: 'control', weight: 50, overrides: {} },
    { key: 'b', weight: 50, overrides: { paywallTitle: 'Unlock everything' } },
  ],
  goalEvent: 'purchase_completed',
});

function error(input: Record<string, unknown>, channel: string | null = null) {
  const result = validateExperimentDefinition(input, channel);
  return result.ok ? null : result.error;
}

describe('validateExperimentDefinition', () => {
  it('accepts a minimal experiment and fills the defaults', () => {
    expect(validateExperimentDefinition(valid(), null)).toEqual({
      ok: true,
      definition: {
        key: 'paywall_copy',
        name: 'Paywall copy',
        channel: null,
        audienceChannels: null,
        runtimeVersions: [],
        trafficPercent: 100,
        variants: valid().variants,
        goalEvent: 'purchase_completed',
        secondaryEvents: [],
      },
    });
  });

  it('checks keys, names and traffic', () => {
    expect(error({ ...valid(), key: 'Paywall' })).toMatch(/lowercase/);
    expect(error({ ...valid(), name: ' ' })).toMatch(/name/);
    expect(error({ ...valid(), trafficPercent: 0 })).toMatch(/trafficPercent/);
    expect(error({ ...valid(), trafficPercent: 50.5 })).toMatch(/trafficPercent/);
  });

  it('needs control first, without overrides, and weights adding up to 100', () => {
    const variants = valid().variants;
    expect(error({ ...valid(), variants: [variants[0]] })).toMatch(/2 to 5/);
    expect(error({ ...valid(), variants: [variants[1], variants[0]] })).toMatch(/first variant/);
    expect(
      error({
        ...valid(),
        variants: [{ ...variants[0], overrides: { a: 1 } }, variants[1]],
      }),
    ).toMatch(/cannot have overrides/);
    expect(error({ ...valid(), variants: [variants[0], { ...variants[1], weight: 40 }] })).toMatch(
      /add up to 100 \(they add up to 90\)/,
    );
    expect(
      error({ ...valid(), variants: [variants[0], { ...variants[1], key: 'control' }] }),
    ).toMatch(/twice/);
    expect(
      error({
        ...valid(),
        variants: [variants[0], { ...variants[1], overrides: { 'bad key': 1 } }],
      }),
    ).toMatch(/Overrides of "b": Invalid key/);
    expect(
      error({
        ...valid(),
        variants: [variants[0], { ...variants[1], overrides: { big: 'x'.repeat(9000) } }],
      }),
    ).toMatch(/over 8 KiB/);
  });

  it('allows code-only experiments without overrides', () => {
    const result = validateExperimentDefinition(
      {
        ...valid(),
        variants: [
          { key: 'control', weight: 34 },
          { key: 'b', weight: 33 },
          { key: 'c', weight: 33, overrides: {} },
        ],
      },
      null,
    );
    expect(result.ok && result.definition.variants.map((variant) => variant.overrides)).toEqual([
      {},
      {},
      {},
    ]);
  });

  it('checks the audience and goals', () => {
    expect(error({ ...valid(), audienceChannels: ['production', null] })).toBeNull();
    expect(error({ ...valid(), audienceChannels: ['production'] }, 'production')).toMatch(
      /Only experiments on the base config/,
    );
    expect(error({ ...valid(), audienceChannels: [] })).toMatch(/audienceChannels/);
    expect(error({ ...valid(), audienceChannels: ['__preview_x'] })).toMatch(/channel names/);
    expect(error({ ...valid(), runtimeVersions: ['1.0', 'a b'] })).toMatch(/runtimeVersions/);
    expect(error({ ...valid(), goalEvent: '$session_start' })).toMatch(/goalEvent/);
    expect(error({ ...valid(), secondaryEvents: ['a', 'b', 'c', 'd'] })).toMatch(/at most 3/);
    const result = validateExperimentDefinition(
      { ...valid(), secondaryEvents: ['signup', 'purchase_completed', 'signup'] },
      null,
    );
    expect(result.ok && result.definition.secondaryEvents).toEqual(['signup']);
  });
});

describe('override keys', () => {
  it('lists and compares the keys experiments override', () => {
    const left = [
      { key: 'control', weight: 50, overrides: {} },
      { key: 'b', weight: 25, overrides: { title: 'x', color: 'red' } },
      { key: 'c', weight: 25, overrides: { title: 'y' } },
    ];
    expect(overriddenKeys(left)).toEqual(['color', 'title']);
    expect(sharedOverrideKeys(left, [{ key: 'b', weight: 50, overrides: { color: 1 } }])).toEqual([
      'color',
    ]);
  });
});

describe('buildExperimentsJson', () => {
  it('writes the device format in a fixed order, or null without experiments', () => {
    expect(buildExperimentsJson([])).toBeNull();
    const json = buildExperimentsJson([
      {
        id: '0b1d2c3e-0000-4000-8000-000000000001',
        key: 'paywall_copy',
        trafficPercent: 80,
        variants: valid().variants,
        goalEvent: 'purchase_completed',
        secondaryEvents: ['signup'],
        audienceChannels: ['production', null],
        runtimeVersions: [],
      },
    ]);
    expect(json).toBe(
      '[{"id":"0b1d2c3e-0000-4000-8000-000000000001","key":"paywall_copy","traffic":80,' +
        '"variants":[{"key":"control","weight":50,"overrides":{}},' +
        '{"key":"b","weight":50,"overrides":{"paywallTitle":"Unlock everything"}}],' +
        '"goals":["purchase_completed","signup"],"channels":["production",null],"runtimeVersions":null}]',
    );
  });
});
