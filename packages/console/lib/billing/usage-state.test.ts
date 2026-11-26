import { describe, expect, it } from 'vitest';

import { computeUsageState, type UsageStateInput } from './usage-state';

function state(overrides: Partial<UsageStateInput>) {
  return computeUsageState({
    downloads: 0,
    includedLimit: 5_000,
    creditsAvailable: 0,
    polarReportedCount: 0,
    overageEnabled: false,
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
      polarTarget: 4_000,
    });
  });

  it('blocks at the included allowance when there are no credits', () => {
    expect(state({ downloads: 4_999 }).usageBlocked).toBe(false);
    expect(state({ downloads: 5_000 }).usageBlocked).toBe(true);
    expect(state({ downloads: 5_000 }).percentage).toBe(100);
  });

  it('spends credits after the allowance and blocks when both are used up', () => {
    const halfway = state({ downloads: 7_500, creditsAvailable: 5_000 });
    expect(halfway).toMatchObject({
      creditsUsed: 2_500,
      creditsRemaining: 2_500,
      effectiveLimit: 10_000,
      percentage: 75,
      usageBlocked: false,
    });

    const exhausted = state({ downloads: 12_000, creditsAvailable: 5_000 });
    expect(exhausted).toMatchObject({
      creditsUsed: 5_000,
      creditsRemaining: 0,
      usageBlocked: true,
      percentage: 120,
    });
  });

  it('never blocks when limits are not enforced (billing off)', () => {
    expect(state({ downloads: 50_000, enforceLimits: false }).usageBlocked).toBe(false);
  });

  it('keeps Pro with additional usage on unblocked and spends credits before overage', () => {
    const result = state({
      downloads: 1_300_000,
      includedLimit: 1_000_000,
      creditsAvailable: 200_000,
      overageEnabled: true,
    });
    expect(result).toMatchObject({
      creditsUsed: 200_000,
      creditsRemaining: 0,
      usageBlocked: false,
    });
    // The meter gets the downloads credits did not cover: 1.1M, so 100k overage.
    expect(result.polarTarget).toBe(1_100_000);
  });

  it('does not let credits cover overage that was already reported to Polar', () => {
    // 150k overage was reported (and will be billed) before a pack was bought.
    const result = state({
      downloads: 1_400_000,
      includedLimit: 1_000_000,
      creditsAvailable: 1_000_000,
      polarReportedCount: 1_150_000,
      overageEnabled: true,
    });
    expect(result.creditsUsed).toBe(250_000);
    expect(result.polarTarget).toBe(1_150_000);
  });

  it('counts reported overage toward the block point after additional usage is turned off', () => {
    const base = {
      includedLimit: 1_000_000,
      creditsAvailable: 0,
      polarReportedCount: 1_100_000,
      overageEnabled: false,
    };
    expect(state({ ...base, downloads: 1_099_999 }).usageBlocked).toBe(false);
    expect(state({ ...base, downloads: 1_100_000 }).usageBlocked).toBe(true);
  });

  it('clamps negative or invalid inputs', () => {
    expect(
      state({ downloads: -5, creditsAvailable: -100, polarReportedCount: Number.NaN }),
    ).toMatchObject({ creditsUsed: 0, creditsRemaining: 0, effectiveLimit: 5_000, polarTarget: 0 });
  });

  it('keeps the Enterprise ceiling finite', () => {
    const result = state({
      downloads: 10,
      includedLimit: Number.MAX_SAFE_INTEGER,
      creditsAvailable: 5_000,
    });
    expect(result.effectiveLimit).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.usageBlocked).toBe(false);
  });
});
