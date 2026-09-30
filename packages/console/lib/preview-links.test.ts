import { describe, expect, it } from 'vitest';

import {
  isPreviewChannel,
  isPreviewToken,
  normalizeUrlScheme,
  previewChannel,
  previewDeepLink,
  previewExitLink,
} from './preview-links';

describe('preview links', () => {
  it('builds the hidden channel and the links the app opens', () => {
    const token = 'abcdefghijklmnopqrstuvwxyz';
    expect(isPreviewToken(token)).toBe(true);
    expect(previewChannel(token)).toBe('__preview_abcdefghijklmnopqrstuvwxyz');
    expect(isPreviewChannel(previewChannel(token))).toBe(true);
    expect(isPreviewChannel('__preview')).toBe(true);
    expect(isPreviewChannel('production')).toBe(false);
    expect(isPreviewChannel(null)).toBe(false);
    expect(previewDeepLink('myapp', token)).toBe(`myapp://otakit-preview?token=${token}`);
    expect(previewExitLink('myapp')).toBe('myapp://otakit-preview?exit=1');
  });

  it('accepts only well-formed tokens', () => {
    for (const invalid of ['', 'short', 'A'.repeat(26), '0'.repeat(26), 'a'.repeat(27), null]) {
      expect(isPreviewToken(invalid)).toBe(false);
    }
  });

  it('normalizes custom URL schemes and refuses web schemes', () => {
    expect(normalizeUrlScheme(' MyApp ')).toBe('myapp');
    expect(normalizeUrlScheme('myapp://')).toBe('myapp');
    expect(normalizeUrlScheme('com.example.app')).toBe('com.example.app');
    for (const invalid of ['https', 'http://', 'file', '1app', 'my app', '', 42]) {
      expect(normalizeUrlScheme(invalid)).toBeNull();
    }
  });
});
