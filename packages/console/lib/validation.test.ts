import { describe, expect, it } from 'vitest';

import {
  isValidAppSlug,
  isValidChannelName,
  normalizeOptionalChannel,
  parsePositiveInteger,
} from './validation';

describe('console validation', () => {
  it('keeps the existing named-channel character rules', () => {
    expect(normalizeOptionalChannel(null)).toBeNull();
    expect(normalizeOptionalChannel('  staging  ')).toBe('staging');
    expect(isValidChannelName('staging')).toBe(true);
    expect(isValidChannelName('base')).toBe(true);
    expect(isValidChannelName('default')).toBe(true);
  });

  it('validates app slugs and positive integer fields', () => {
    expect(isValidAppSlug('com.example.app')).toBe(true);
    expect(isValidAppSlug('x')).toBe(false);
    expect(parsePositiveInteger(50)).toBe(50);
    expect(parsePositiveInteger(0)).toBeNull();
    expect(parsePositiveInteger(undefined, { optional: true })).toBeUndefined();
  });
});
