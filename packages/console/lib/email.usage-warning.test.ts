import { describe, expect, it } from 'vitest';

import { usageWarningNextStep } from './email';

describe('usage warning next step', () => {
  it('offers each plan its pack and the next plan up', () => {
    expect(usageWarningNextStep({ planKey: 'free', includedLimit: 5_000, threshold: 90 })).toBe(
      'Add 5,000 extra downloads for $5, or move to Starter for 100,000 downloads a month.',
    );
    expect(
      usageWarningNextStep({ planKey: 'starter', includedLimit: 100_000, threshold: 90 }),
    ).toBe('Add 100,000 extra downloads for $10, or move to Pro for 1,000,000 downloads a month.');
    expect(usageWarningNextStep({ planKey: 'pro', includedLimit: 1_000_000, threshold: 90 })).toBe(
      'Add 1,000,000 extra downloads for $50.',
    );
  });

  it('says updates are paused at 100%', () => {
    expect(usageWarningNextStep({ planKey: 'pro', includedLimit: 1_000_000, threshold: 100 })).toBe(
      'Update downloads are paused until next month starts or you add downloads. Add 1,000,000 extra downloads for $50.',
    );
  });

  it('does not offer Starter to a grandfathered Free workspace that already has 100,000', () => {
    expect(usageWarningNextStep({ planKey: 'free', includedLimit: 100_000, threshold: 90 })).toBe(
      'Add 5,000 extra downloads for $5, or move to Pro for 1,000,000 downloads a month.',
    );
  });

  it('has nothing to add for Enterprise', () => {
    expect(
      usageWarningNextStep({
        planKey: 'enterprise',
        includedLimit: Number.MAX_SAFE_INTEGER,
        threshold: 90,
      }),
    ).toBeNull();
  });
});
