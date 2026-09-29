import { describe, expect, it } from 'vitest';

import { normalizeChannel, parsePositiveInteger, parseRolloutPercent } from './validate.js';

describe('CLI validation', () => {
  it('normalizes a named channel without changing its identity', () => {
    expect(normalizeChannel('  staging.us  ')).toBe('staging.us');
  });

  it('rejects an empty named channel', () => {
    expect(() => normalizeChannel('   ')).toThrow('Channel cannot be empty');
  });

  it('accepts whole rollout percentages from 1 to 100', () => {
    expect(parseRolloutPercent('10', '--rollout')).toBe(10);
    expect(parseRolloutPercent(' 25% ', '--rollout')).toBe(25);
    expect(parseRolloutPercent('100', '--rollout')).toBe(100);
    for (const invalid of ['0', '101', '12.5', '-5', 'ten', '']) {
      expect(() => parseRolloutPercent(invalid, '--rollout')).toThrow(
        '--rollout must be a whole percentage between 1 and 100',
      );
    }
  });

  it('accepts only positive integer options', () => {
    expect(parsePositiveInteger('25', '--limit')).toBe(25);
    expect(() => parsePositiveInteger('0', '--limit')).toThrow(
      '--limit must be a positive integer',
    );
  });
});
