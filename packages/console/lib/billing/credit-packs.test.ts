import { describe, expect, it } from 'vitest';

import {
  formatCreditPackDownloads,
  formatCreditPackPrice,
  getCreditPackForPlan,
  isCreditPackKey,
} from './credit-packs';

describe('credit packs', () => {
  it('offers one pack per self-serve plan', () => {
    expect(getCreditPackForPlan('free')).toMatchObject({ downloads: 5_000, priceCents: 500 });
    expect(getCreditPackForPlan('starter')).toMatchObject({
      downloads: 100_000,
      priceCents: 1_000,
    });
    expect(getCreditPackForPlan('pro')).toMatchObject({ downloads: 1_000_000, priceCents: 5_000 });
    expect(getCreditPackForPlan('enterprise')).toBeNull();
    expect(getCreditPackForPlan(undefined)).toBeNull();
  });

  it('formats prices and sizes for copy', () => {
    const pack = getCreditPackForPlan('starter')!;
    expect(formatCreditPackPrice(pack)).toBe('$10');
    expect(formatCreditPackPrice({ priceCents: 1_250 })).toBe('$12.50');
    expect(formatCreditPackDownloads(pack)).toBe('100,000');
  });

  it('validates pack keys from request bodies', () => {
    expect(isCreditPackKey('downloads_5k')).toBe(true);
    expect(isCreditPackKey('downloads_50k')).toBe(false);
    expect(isCreditPackKey(undefined)).toBe(false);
  });
});
