import { describe, expect, it } from 'vitest';

import { normalizeChannel, parsePositiveInteger } from './validate.js';

describe('CLI validation', () => {
  it('normalizes a named channel without changing its identity', () => {
    expect(normalizeChannel('  staging.us  ')).toBe('staging.us');
  });

  it('rejects an empty named channel', () => {
    expect(() => normalizeChannel('   ')).toThrow('Channel cannot be empty');
  });

  it('accepts only positive integer options', () => {
    expect(parsePositiveInteger('25', '--limit')).toBe(25);
    expect(() => parsePositiveInteger('0', '--limit')).toThrow(
      '--limit must be a positive integer',
    );
  });
});
