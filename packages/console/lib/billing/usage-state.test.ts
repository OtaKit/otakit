import { describe, expect, it } from 'vitest';

import { computeUsageState, nextUsageWarning, type UsageStateInput } from './usage-state';

function state(overrides: Partial<UsageStateInput>) {
  return computeUsageState({
    downloads: 0,
    includedLimit: 5_000,
    creditsAvailable: 0,
    enforceLimits: true,
    ...overrides,
  });
}

describe('computeUsageState', () => {
  it('uses no credits inside the included allowance', () => {
    expect(state({ downloads: 4_000, creditsAvailable: 5_000 })).toEqual({
      creditsUsed: 0,
      creditsRemaining: 5_000,
      effectiveLimit: 10_000,
      percentage: 40,
      usageBlocked: false,
    });
  });

  it('pauses at the included allowance when there are no credits', () => {
    expect(state({ downloads: 4_999 }).usageBlocked).toBe(false);
    expect(state({ downloads: 5_000 })).toMatchObject({ usageBlocked: true, percentage: 100 });
  });

  it('spends credits after the allowance and pauses when both are used up', () => {
    expect(state({ downloads: 7_500, creditsAvailable: 5_000 })).toMatchObject({
      creditsUsed: 2_500,
      creditsRemaining: 2_500,
      effectiveLimit: 10_000,
      percentage: 75,
      usageBlocked: false,
    });
    expect(state({ downloads: 12_000, creditsAvailable: 5_000 })).toMatchObject({
      creditsUsed: 5_000,
      creditsRemaining: 0,
      usageBlocked: true,
      percentage: 120,
    });
  });

  it('works the same way for Pro: 1M included, then a 1M pack', () => {
    expect(
      state({ downloads: 1_300_000, includedLimit: 1_000_000, creditsAvailable: 1_000_000 }),
    ).toMatchObject({ creditsUsed: 300_000, creditsRemaining: 700_000, usageBlocked: false });
    expect(state({ downloads: 1_000_000, includedLimit: 1_000_000 }).usageBlocked).toBe(true);
  });

  it('reads 100% only once the limit is reached', () => {
    expect(state({ downloads: 4_999 }).percentage).toBe(99);
    expect(state({ downloads: 4_500 }).percentage).toBe(90);
  });

  it('never blocks when limits are not enforced (billing off)', () => {
    expect(state({ downloads: 50_000, enforceLimits: false }).usageBlocked).toBe(false);
  });

  it('clamps negative or invalid inputs', () => {
    expect(state({ downloads: -5, creditsAvailable: Number.NaN })).toMatchObject({
      creditsUsed: 0,
      creditsRemaining: 0,
      effectiveLimit: 5_000,
    });
  });

  it('keeps the Enterprise ceiling finite and never pauses it', () => {
    const result = state({
      downloads: 10,
      includedLimit: Number.MAX_SAFE_INTEGER,
      creditsAvailable: 5_000,
    });
    expect(result.effectiveLimit).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.usageBlocked).toBe(false);
  });
});

describe('nextUsageWarning', () => {
  it('sends 90% once, then 100% once', () => {
    expect(nextUsageWarning({ previous: 'none', percentage: 92, sendWarnings: true })).toEqual({
      warningSent: 'at90',
      threshold: 90,
    });
    expect(nextUsageWarning({ previous: 'at90', percentage: 95, sendWarnings: true })).toEqual({
      warningSent: 'at90',
      threshold: null,
    });
    expect(nextUsageWarning({ previous: 'at90', percentage: 100, sendWarnings: true })).toEqual({
      warningSent: 'at100',
      threshold: 100,
    });
    expect(nextUsageWarning({ previous: 'at100', percentage: 130, sendWarnings: true })).toEqual({
      warningSent: 'at100',
      threshold: null,
    });
  });

  it('goes straight to 100% when usage jumps past 90%', () => {
    expect(nextUsageWarning({ previous: 'none', percentage: 100, sendWarnings: true })).toEqual({
      warningSent: 'at100',
      threshold: 100,
    });
  });

  it('re-arms the 100% email after a pack, without repeating the 90% one', () => {
    // Paused and emailed, then a pack leaves usage at 95% of the new ceiling.
    const afterPack = nextUsageWarning({ previous: 'at100', percentage: 95, sendWarnings: false });
    expect(afterPack).toEqual({ warningSent: 'at90', threshold: null });
    expect(
      nextUsageWarning({ previous: afterPack.warningSent, percentage: 97, sendWarnings: true }),
    ).toEqual({ warningSent: 'at90', threshold: null });
    expect(
      nextUsageWarning({ previous: afterPack.warningSent, percentage: 100, sendWarnings: true }),
    ).toEqual({ warningSent: 'at100', threshold: 100 });
  });

  it('re-arms everything when usage drops under 90%, even without sending', () => {
    expect(nextUsageWarning({ previous: 'at100', percentage: 50, sendWarnings: false })).toEqual({
      warningSent: 'none',
      threshold: null,
    });
  });

  it('records nothing new when warnings are not sent', () => {
    expect(nextUsageWarning({ previous: 'none', percentage: 100, sendWarnings: false })).toEqual({
      warningSent: 'none',
      threshold: null,
    });
  });
});
