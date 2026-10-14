import { describe, expect, it } from 'vitest';

import type { ExperimentResults, ExperimentSummary } from './api.js';
import { formatExperimentList, formatExperimentResults } from './experiments.js';

const experiment: ExperimentSummary = {
  id: '0b1d2c3e-0000-4000-8000-00000000000a',
  key: 'paywall_copy',
  name: 'Paywall copy',
  status: 'running',
  channel: null,
  audienceChannels: null,
  runtimeVersions: [],
  trafficPercent: 100,
  variants: [
    { key: 'control', weight: 50, overrides: {} },
    { key: 'b', weight: 50, overrides: { paywallTitle: 'Unlock everything' } },
  ],
  goalEvent: 'purchase_completed',
  secondaryEvents: [],
  overriddenKeys: ['paywallTitle'],
  startedAt: '2026-10-01T10:00:00.000Z',
  stoppedAt: null,
  shippedVariant: null,
  createdBy: 'dev@acme.test',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const variant = (key: string, exposed: number, converted: number, best: number) => ({
  key,
  exposed,
  converted,
  rate: converted / exposed,
  probabilityBest: best,
  probabilityBetterThanControl: key === 'control' ? null : best,
  lift: key === 'control' ? null : { low: 0.02, median: 0.3, high: 0.61 },
  errors: 3,
  errorRate: 3 / exposed,
  probabilityMoreErrors: null,
  guardrail: 'ok' as const,
  secondary: {},
});

describe('experiment output', () => {
  it('lists tests as a table', () => {
    expect(formatExperimentList([])).toMatch(/No A\/B tests yet/);
    expect(
      formatExperimentList([
        experiment,
        { ...experiment, key: 'old_test', status: 'shipped', shippedVariant: 'b', channel: 'beta' },
      ]),
    ).toBe(
      [
        'KEY           STATUS     CONFIG       VARIANTS             GOAL',
        'paywall_copy  running    base config  control 50% / b 50%  purchase_completed',
        'old_test      shipped b  beta config  control 50% / b 50%  purchase_completed',
      ].join('\n'),
    );
  });

  it('prints results with the verdict and a table', () => {
    const result: ExperimentResults = {
      experiment,
      daysRunning: 10,
      analyticsAvailable: true,
      analyticsPausedUntil: null,
      series: [],
      stats: {
        plannedPerVariant: 3841,
        verdict: { kind: 'winner', variant: 'b', probability: 0.98 },
        variants: [variant('control', 1000, 100, 0.02), variant('b', 1000, 130, 0.98)],
      },
    };
    expect(formatExperimentResults(result)).toBe(
      [
        'paywall_copy · running · base config · goal purchase_completed · 10 days',
        'b is better: 98% probability to be best.',
        '',
        'VARIANT  DEVICES  CONVERTED  RATE   LIFT (95%)          BEST   ERRORS',
        'control  1,000    100        10.0%  –                   2.0%   3',
        'b        1,000    130        13.0%  +30% (+2% to +61%)  98.0%  3',
        '',
        "About 3,841 devices per variant detect a 20% change at control's rate.",
      ].join('\n'),
    );
    expect(formatExperimentResults({ ...result, stats: null })).toBe(
      'paywall_copy · running · base config · goal purchase_completed\nNot started yet: no results.',
    );
  });
});
