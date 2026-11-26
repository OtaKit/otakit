import { describe, expect, it } from 'vitest';

import { usageWarningNextStep } from './email';

describe('usage warning next step', () => {
  it('offers each plan its pack and the next plan up', () => {
    expect(
      usageWarningNextStep({
        planKey: 'free',
        includedLimit: 5_000,
        threshold: 90,
        overageEnabled: false,
      }),
    ).toBe('Add 5,000 extra downloads for $5, or move to Starter for 100,000 downloads a month.');
    expect(
      usageWarningNextStep({
        planKey: 'starter',
        includedLimit: 100_000,
        threshold: 90,
        overageEnabled: false,
      }),
    ).toBe('Add 100,000 extra downloads for $10, or move to Pro for 1,000,000 downloads a month.');
    expect(
      usageWarningNextStep({
        planKey: 'pro',
        includedLimit: 1_000_000,
        threshold: 90,
        overageEnabled: false,
      }),
    ).toBe('Add 1,000,000 extra downloads for $50, or turn on additional usage in settings.');
  });

  it('says updates are paused at 100% unless additional usage is on', () => {
    expect(
      usageWarningNextStep({
        planKey: 'free',
        includedLimit: 5_000,
        threshold: 100,
        overageEnabled: false,
      }),
    ).toMatch(
      /^Update downloads are paused until next month starts or you add downloads\. Add 5,000/,
    );
    expect(
      usageWarningNextStep({
        planKey: 'pro',
        includedLimit: 1_000_000,
        threshold: 100,
        overageEnabled: true,
      }),
    ).toBe(
      'Additional usage is on, so updates keep being delivered at $50 per extra 1,000,000 downloads.',
    );
  });

  it('does not offer Starter to a grandfathered Free workspace that already has 100,000', () => {
    expect(
      usageWarningNextStep({
        planKey: 'free',
        includedLimit: 100_000,
        threshold: 90,
        overageEnabled: false,
      }),
    ).toBe('Add 5,000 extra downloads for $5, or move to Pro for 1,000,000 downloads a month.');
  });

  it('has nothing to add for Enterprise', () => {
    expect(
      usageWarningNextStep({
        planKey: 'enterprise',
        includedLimit: Number.MAX_SAFE_INTEGER,
        threshold: 90,
        overageEnabled: false,
      }),
    ).toBeNull();
  });
});
