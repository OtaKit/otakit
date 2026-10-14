import { describe, expect, it } from 'vitest';

import { analyzeExperiment, plannedSamplePerVariant, type VariantCounts } from './experiment-stats';

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
    expect(stats.verdict).toEqual({ kind: 'winner', variant: 'b', probability: b.probabilityBest });
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

  it('names control the winner when the variant is clearly worse', () => {
    const stats = analyzeExperiment({
      variants: [variant('control', 5000, 600), variant('b', 5000, 480)],
      daysRunning: 14,
      seed: 's',
    });
    expect(stats.verdict).toMatchObject({ kind: 'winner', variant: 'control' });
    expect(stats.variants[1].lift!.high).toBeLessThan(0);
  });

  it('reports no clear difference once the planned sample is reached', () => {
    expect(plannedSamplePerVariant(0.1)).toBe(3841);
    const stats = analyzeExperiment({
      variants: [variant('control', 4000, 400), variant('b', 4000, 401)],
      daysRunning: 14,
      seed: 's',
    });
    expect(stats.plannedPerVariant).toBe(3841);
    expect(stats.verdict).toEqual({ kind: 'no_difference' });
  });

  it('shows the leader before the planned sample', () => {
    const stats = analyzeExperiment({
      variants: [variant('control', 1000, 100), variant('b', 1000, 108)],
      daysRunning: 8,
      seed: 's',
    });
    expect(stats.verdict).toMatchObject({ kind: 'leading', variant: 'b' });
  });

  it('flags a variant with clearly more devices with errors, at any time', () => {
    const stats = analyzeExperiment({
      variants: [variant('control', 3000, 10, 20), variant('b', 3000, 30, 60)],
      daysRunning: 1,
      seed: 's',
    });
    expect(stats.variants[1].guardrail).toBe('worse');
    expect(stats.verdict).toMatchObject({ kind: 'guardrail', variant: 'b' });
    const few = analyzeExperiment({
      variants: [variant('control', 3000, 10, 0), variant('b', 3000, 30, 9)],
      daysRunning: 1,
      seed: 's',
    });
    expect(few.variants[1].probabilityMoreErrors).toBeGreaterThan(0.95);
    expect(few.variants[1].guardrail).toBe('ok');
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

describe('plannedSamplePerVariant', () => {
  it('needs a positive rate that can grow by 20%', () => {
    expect(plannedSamplePerVariant(null)).toBeNull();
    expect(plannedSamplePerVariant(0)).toBeNull();
    expect(plannedSamplePerVariant(0.9)).toBeNull();
    expect(plannedSamplePerVariant(0.05)).toBeGreaterThan(plannedSamplePerVariant(0.1)!);
  });
});
