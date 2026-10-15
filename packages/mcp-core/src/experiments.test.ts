import { describe, expect, it } from 'vitest';

import {
  experimentChangeSummary,
  experimentListSummary,
  experimentResultsParts,
  experimentVerdictSentence,
} from './experiments';

const experiment = {
  key: 'paywall_copy',
  name: 'Paywall copy',
  status: 'running' as const,
  channel: null,
  variants: [
    { key: 'control', weight: 50 },
    { key: 'b', weight: 50 },
  ],
  goalEvent: 'purchase_completed',
  overriddenKeys: ['paywallTitle'],
  startedAt: '2026-10-01T10:00:00.000Z',
  shippedVariant: null,
};

describe('experiment summaries', () => {
  it('lists tests with their status, split and goal', () => {
    expect(experimentListSummary([])).toBe('The app has no A/B tests.');
    expect(
      experimentListSummary([
        experiment,
        { ...experiment, key: 'old', status: 'shipped', shippedVariant: 'b', channel: 'beta' },
      ]),
    ).toBe(
      '2 A/B tests, 1 running: paywall_copy (running, control 50% / b 50%, goal purchase_completed, on the base config); old (shipped b, control 50% / b 50%, goal purchase_completed, on the beta config).',
    );
  });

  it('says the verdict in plain language', () => {
    expect(
      experimentVerdictSentence({ kind: 'collecting', daysLeft: 3, conversionsNeeded: 40 }),
    ).toBe(
      'Not enough data yet: a result needs 3 more days and 40 more conversions in the smallest variant.',
    );
    expect(
      experimentVerdictSentence({
        kind: 'winner',
        variant: 'b',
        probability: 0.9812,
        decidedOn: '2026-10-09',
      }),
    ).toBe('b is better: 98.1% probability to be best at the planned sample (2026-10-09).');
    expect(
      experimentVerdictSentence({
        kind: 'leading',
        variant: 'b',
        probability: 0.9,
        devicesNeeded: 1200,
      }),
    ).toBe(
      'No result yet: b leads with 90.0% probability to be best; the result is decided once, at the planned sample (1,200 more devices in the smallest variant).',
    );
    expect(experimentVerdictSentence({ kind: 'guardrail', variant: 'b', probability: 0.97 })).toBe(
      'b has more devices with errors than control (97.0% probability).',
    );
  });

  it('summarizes results with lifts and warnings', () => {
    const parts = experimentResultsParts({
      experiment,
      daysRunning: 10,
      analyticsAvailable: true,
      stats: {
        plannedPerVariant: 3841,
        verdict: { kind: 'winner', variant: 'b', probability: 0.98, decidedOn: '2026-10-09' },
        variants: [
          {
            key: 'control',
            exposed: 1000,
            converted: 100,
            rate: 0.1,
            probabilityBest: 0.02,
            lift: null,
            errors: 0,
            guardrail: 'ok',
          },
          {
            key: 'b',
            exposed: 1000,
            converted: 130,
            rate: 0.13,
            probabilityBest: 0.98,
            lift: { low: 0.02, median: 0.3, high: 0.61 },
            errors: 0,
            guardrail: 'ok',
          },
        ],
      },
    });
    expect(parts.summary).toBe(
      'paywall_copy (running, 10 days, goal purchase_completed): b is better: 98.0% probability to be best at the planned sample (2026-10-09). control: 10.0% of 1,000 devices converted, 2.0% to be best; b: 13.0% of 1,000 devices converted, lift +30% (+2% to +61%), 98.0% to be best.',
    );
    expect(parts.warnings).toEqual([]);
    // Without devices in every variant, no lifts or probabilities.
    expect(
      experimentResultsParts({
        experiment,
        daysRunning: 0.2,
        analyticsAvailable: true,
        stats: {
          comparable: false,
          plannedPerVariant: null,
          verdict: { kind: 'collecting', daysLeft: 7, conversionsNeeded: 100 },
          variants: [
            {
              key: 'control',
              exposed: 3,
              converted: 0,
              rate: 0,
              probabilityBest: 0.4,
              lift: null,
              errors: 0,
              guardrail: 'ok',
            },
            {
              key: 'b',
              exposed: 0,
              converted: 0,
              rate: null,
              probabilityBest: 0.6,
              lift: { low: -0.9, median: 0.1, high: 9 },
              errors: 0,
              guardrail: 'ok',
            },
          ],
        },
      }).summary,
    ).toBe(
      'paywall_copy (running, 0.2 days, goal purchase_completed): Not enough data yet: a result needs 7 more days and 100 more conversions in the smallest variant. control: 0.0% of 3 devices converted; b: – of 0 devices converted.',
    );
    expect(
      experimentResultsParts({
        experiment: { ...experiment, status: 'draft', startedAt: null },
        stats: null,
        daysRunning: 0,
        analyticsAvailable: false,
      }),
    ).toEqual({
      summary: 'paywall_copy has not started, so it has no results yet.',
      warnings: ['Analytics are unavailable right now: the counts can be incomplete.'],
    });
  });

  it('says what stopping and shipping changed', () => {
    expect(
      experimentChangeSummary('stopped', {
        experiment: { ...experiment, status: 'stopped' },
        publicationStatus: 'pending',
      }),
    ).toEqual({
      summary:
        'Stopped paywall_copy. Devices get the normal values of the base config on their next config fetch; the results stay readable.',
      warnings: [
        'The change is saved, but writing the config file to the CDN failed; OtaKit retries within minutes. Do not repeat it.',
      ],
    });
    expect(
      experimentChangeSummary('shipped', {
        experiment: { ...experiment, status: 'shipped', shippedVariant: 'b' },
        publicationStatus: 'published',
        changedKeys: ['paywallTitle'],
      }).summary,
    ).toBe(
      'Shipped b of paywall_copy: paywallTitle is now part of the base config for every device, from their next config fetch.',
    );
  });
});
