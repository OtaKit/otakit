import { describe, expect, it } from 'vitest';

import {
  isReleasableChannelName,
  isValidAppSlug,
  isValidChannelName,
  normalizeOptionalChannel,
  normalizeReleaseNotes,
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

  it('reserves preview channels for preview links but still lets filters name them', () => {
    expect(isReleasableChannelName('__preview')).toBe(false);
    expect(isReleasableChannelName('__preview_abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(isReleasableChannelName('__PREVIEW_x')).toBe(false);
    expect(isReleasableChannelName('preview')).toBe(true);
    expect(isReleasableChannelName('_preview')).toBe(true);
    expect(isValidChannelName('__preview')).toBe(true);
  });

  it('validates app slugs and positive integer fields', () => {
    expect(isValidAppSlug('com.example.app')).toBe(true);
    expect(isValidAppSlug('x')).toBe(false);
    expect(parsePositiveInteger(50)).toBe(50);
    expect(parsePositiveInteger(0)).toBeNull();
    expect(parsePositiveInteger(undefined, { optional: true })).toBeUndefined();
  });

  it('normalises release notes once, before they are stored and signed', () => {
    expect(normalizeReleaseNotes(undefined)).toEqual({ notes: undefined });
    expect(normalizeReleaseNotes(null)).toEqual({ notes: null });
    expect(normalizeReleaseNotes('  \n ')).toEqual({ notes: null });
    expect(normalizeReleaseNotes(' A\r\nB\rC\tD ')).toEqual({ notes: 'A\nB\nC\tD' });
    expect(normalizeReleaseNotes('x'.repeat(2000))).toEqual({ notes: 'x'.repeat(2000) });
    expect(normalizeReleaseNotes('x'.repeat(2001))).toHaveProperty('error');
    expect(normalizeReleaseNotes('a\u0000b')).toHaveProperty('error');
    expect(normalizeReleaseNotes(42)).toHaveProperty('error');
  });
});
