import { describe, expect, it } from 'vitest';

import {
  analyzeExperiment,
  decisionThreshold,
  findDecision,
  plannedSamplePerVariant,
  type DailyCounts,
  type VariantCounts,
} from './experiment-stats';

const variant = (
  key: string,
  exposed: number,
  converted: number,
  errors = 0,
  secondary?: Record<string, number>,
): VariantCounts => ({ key, exposed, converted, errors, secondary });

describe('analyzeExperiment', () => {
  it('matches the known fixture: 100 of 1,000 against 130 of 1,000', () => {
    const stats = analyzeExperiment({
      variants: [variant('control', 1000, 100), variant('b', 1000, 130)],
      daysRunning: 10,
      seed: 'fixture',
    });
    const [control, b] = stats.variants;
    expect(stats.comparable).toBe(true);
    expect(control).toMatchObject({ rate: 0.1, probabilityBetterThanControl: null, lift: null });
    expect(b.rate).toBe(0.13);
    // Normal approximation: P(B > A) = Φ(0.03 / 0.01425) ≈ 0.982.
    expect(b.probabilityBest).toBeGreaterThan(0.97);
    expect(b.probabilityBest).toBeLessThan(0.99);
    expect(b.probabilityBetterThanControl).toBe(b.probabilityBest);
    expect(control.probabilityBest + b.probabilityBest).toBeCloseTo(1, 6);
    expect(b.lift!.median).toBeGreaterThan(0.25);
    expect(b.lift!.median).toBeLessThan(0.35);
    expect(b.lift!.low).toBeGreaterThan(0);
    expect(b.lift!.high).toBeGreaterThan(b.lift!.median);
    // Without the decision day, no result: only who leads.
    expect(stats.verdict).toEqual({
      kind: 'leading',
      variant: 'b',
      probability: b.probabilityBest,
      devicesNeeded: 3841 - 1000,
    });
  });

  it('gives the same numbers for the same counts', () => {
    const input = {
      variants: [variant('control', 500, 40, 3), variant('b', 480, 52, 4)],
      daysRunning: 3,
      seed: 'experiment-1',
    };
    expect(analyzeExperiment(input)).toEqual(analyzeExperiment(input));
  });

  it('collects data until 7 days and 100 conversions per variant', () => {
    const early = analyzeExperiment({
      variants: [variant('control', 5000, 500), variant('b', 5000, 700)],
      daysRunning: 2.5,
      seed: 's',
    });
    expect(early.verdict).toEqual({ kind: 'collecting', daysLeft: 5, conversionsNeeded: 0 });
    const small = analyzeExperiment({
      variants: [variant('control', 400, 40), variant('b', 400, 90)],
      daysRunning: 9,
      seed: 's',
    });
    expect(small.verdict).toEqual({ kind: 'collecting', daysLeft: 0, conversionsNeeded: 60 });
  });

  const decision = (
    day: string,
    counts: Array<[string, number, number]>,
  ): Parameters<typeof analyzeExperiment>[0]['decision'] => ({
    day,
    daysRunning: 8,
    plannedPerVariant: 3841,
    variants: counts.map(([key, exposed, converted]) => ({ key, exposed, converted })),
  });

  it('decides on the decision day data: a winner past its threshold', () => {
    const stats = analyzeExperiment({
      variants: [variant('control', 6000, 600), variant('b', 6000, 840)],
      daysRunning: 14,
      seed: 's',
      decision: decision('2026-10-09', [
        ['control', 4000, 400],
        ['b', 4000, 560],
      ]),
    });
    expect(stats.verdict).toMatchObject({ kind: 'winner', variant: 'b', decidedOn: '2026-10-09' });
  });

  it('names control the winner when the variant is clearly worse', () => {
    const stats = analyzeExperiment({
      variants: [variant('control', 5000, 600), variant('b', 5000, 480)],
      daysRunning: 14,
      seed: 's',
      decision: decision('2026-10-09', [
        ['control', 5000, 600],
        ['b', 5000, 480],
      ]),
    });
    expect(stats.verdict).toMatchObject({ kind: 'winner', variant: 'control' });
    expect(stats.variants[1].lift!.high).toBeLessThan(0);
  });

  it('reports no clear difference when the decision day shows none', () => {
    expect(plannedSamplePerVariant(0.1)).toBe(3841);
    const stats = analyzeExperiment({
      variants: [variant('control', 9000, 900), variant('b', 9000, 990)],
      daysRunning: 20,
      seed: 's',
      // Later data leans to b; the result was decided before and stays.
      decision: decision('2026-10-09', [
        ['control', 4000, 400],
        ['b', 4000, 401],
      ]),
    });
    expect(stats.plannedPerVariant).toBe(3841);
    expect(stats.verdict).toEqual({ kind: 'no_difference', decidedOn: '2026-10-09' });
  });

  it('asks more of a variant when there are several', () => {
    expect(decisionThreshold('control', 2)).toBe(0.95);
    expect(decisionThreshold('b', 2)).toBeCloseTo(0.95, 10);
    expect(decisionThreshold('b', 4)).toBeCloseTo(1 - 0.05 / 3, 10);
  });

  it('shows the leader before the planned sample', () => {
    const stats = analyzeExperiment({
      variants: [variant('control', 1000, 100), variant('b', 1000, 108)],
      daysRunning: 8,
      seed: 's',
    });
    expect(stats.verdict).toMatchObject({ kind: 'leading', variant: 'b' });
  });

  it('flags a variant with clearly more devices with errors, from the third day', () => {
    const counts = [variant('control', 3000, 10, 20), variant('b', 3000, 30, 60)];
    const stats = analyzeExperiment({ variants: counts, daysRunning: 3, seed: 's' });
    expect(stats.variants[1].guardrail).toBe('worse');
    expect(stats.verdict).toMatchObject({ kind: 'guardrail', variant: 'b' });
    // Too early, too few, or not clear enough: no flag.
    expect(
      analyzeExperiment({ variants: counts, daysRunning: 2.5, seed: 's' }).variants[1].guardrail,
    ).toBe('ok');
    const few = analyzeExperiment({
      variants: [variant('control', 3000, 10, 0), variant('b', 3000, 30, 9)],
      daysRunning: 5,
      seed: 's',
    });
    expect(few.variants[1].probabilityMoreErrors).toBeGreaterThan(0.995);
    expect(few.variants[1].guardrail).toBe('ok');
    const unclear = analyzeExperiment({
      variants: [variant('control', 3000, 10, 20), variant('b', 3000, 30, 34)],
      daysRunning: 5,
      seed: 's',
    });
    expect(unclear.variants[1].probabilityMoreErrors).toBeGreaterThan(0.95);
    expect(unclear.variants[1].guardrail).toBe('ok');
  });
  it('handles empty variants, impossible counts and secondary goals', () => {
    const stats = analyzeExperiment({
      variants: [
        variant('control', 0, 0),
        variant('b', 10, 50, 20, { signup: 30 }),
        variant('c', 10, 2, 0, { signup: 1 }),
      ],
      daysRunning: 0,
      seed: 's',
    });
    expect(stats.comparable).toBe(false);
    expect(stats.variants[0]).toMatchObject({ rate: null, errorRate: null });
    expect(stats.variants[1]).toMatchObject({ converted: 10, errors: 10, rate: 1 });
    expect(stats.variants[1].secondary.signup).toMatchObject({ converted: 10, rate: 1 });
    expect(stats.variants[0].secondary.signup).toMatchObject({
      converted: 0,
      probabilityBetterThanControl: null,
    });
    expect(stats.plannedPerVariant).toBeNull();
    // Each probability is rounded to 4 digits.
    const total = stats.variants.reduce((sum, row) => sum + row.probabilityBest, 0);
    expect(Math.abs(total - 1)).toBeLessThanOrEqual(0.0002);
  });

  it('is fast enough for five variants with secondary goals', () => {
    const started = performance.now();
    analyzeExperiment({
      variants: ['control', 'b', 'c', 'd', 'e'].map((key, index) =>
        variant(key, 200_000 + index, 20_000 + index * 50, 300, { a: 1000, b: 2000 }),
      ),
      daysRunning: 30,
      seed: 's',
    });
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('findDecision', () => {
  const START = Date.parse('2026-10-01T10:00:00.000Z');
  const point = (day: string, control: [number, number], b: [number, number]): DailyCounts => ({
    day,
    variants: [
      { key: 'control', exposed: control[0], converted: control[1] },
      { key: 'b', exposed: b[0], converted: b[1] },
    ],
  });
  const series = [
    point('2026-10-03', [2000, 200], [2000, 230]),
    // Enough devices, but under 7 days (ends 6.6 days after the start).
    point('2026-10-07', [4000, 400], [4000, 470]),
    // 7.6 days: decided here.
    point('2026-10-08', [4100, 410], [4100, 480]),
    point('2026-10-09', [4500, 450], [4500, 520]),
  ];

  it('picks the first full day that met every condition', () => {
    expect(findDecision(series, START, Date.parse('2026-10-20T00:00:00.000Z'))).toMatchObject({
      day: '2026-10-08',
      plannedPerVariant: 3841,
      variants: [
        { key: 'control', exposed: 4100 },
        { key: 'b', exposed: 4100 },
      ],
    });
  });

  it('waits for the day to end, and for every variant to have enough', () => {
    expect(findDecision(series, START, Date.parse('2026-10-08T23:00:00.000Z'))).toBeNull();
    const short = series.map((entry) => ({
      ...entry,
      variants: [entry.variants[0], { ...entry.variants[1], exposed: 3000 }],
    }));
    expect(findDecision(short, START, Date.parse('2026-10-20T00:00:00.000Z'))).toBeNull();
    const few = series.map((entry) => ({
      ...entry,
      variants: [entry.variants[0], { ...entry.variants[1], converted: 99 }],
    }));
    expect(findDecision(few, START, Date.parse('2026-10-20T00:00:00.000Z'))).toBeNull();
  });
});

describe('plannedSamplePerVariant', () => {
  it('needs a positive rate that can grow by 20%', () => {
    expect(plannedSamplePerVariant(null)).toBeNull();
    expect(plannedSamplePerVariant(0)).toBeNull();
    expect(plannedSamplePerVariant(0.9)).toBeNull();
    expect(plannedSamplePerVariant(0.05)).toBeGreaterThan(plannedSamplePerVariant(0.1)!);
  });
});
