import { describe, expect, it } from 'vitest';

import { describeBundleDiff, formatBundleBytes } from './bundle-diff';

const ok = {
  target: { version: '1.4.2' },
  base: { version: '1.4.1' },
  status: 'ok' as const,
  unavailableReason: null,
  comparable: true,
  summary: {
    added: 3,
    removed: 1,
    changed: 12,
    totalBefore: 4.1 * 1024 * 1024,
    totalAfter: 4.3 * 1024 * 1024,
    downloadBytes: 38 * 1024,
  },
};

describe('describeBundleDiff', () => {
  it('summarizes a comparison in one line', () => {
    expect(describeBundleDiff(ok)).toBe(
      '1.4.2 vs 1.4.1: +3 ~12 -1 · 4.1 MB → 4.3 MB · devices download ≈ 38.0 KB',
    );
    expect(
      describeBundleDiff({
        ...ok,
        comparable: false,
        summary: { ...ok.summary, downloadBytes: null },
      }),
    ).toBe(
      '1.4.2 vs 1.4.1: +3 ~12 -1 · 4.1 MB → 4.3 MB · devices download up to the full bundle (by size: one bundle is zip, the other deltas)',
    );
  });

  it('can name the base by its channel', () => {
    expect(describeBundleDiff(ok, { baseLabel: 'production (1.4.1)' })).toMatch(
      /^1\.4\.2 vs production \(1\.4\.1\): \+3/,
    );
  });

  it('describes a first upload and unreadable bundles', () => {
    expect(
      describeBundleDiff({
        ...ok,
        base: null,
        summary: { ...ok.summary, added: 4, totalAfter: 980 },
      }),
    ).toBe('1.4.2: 4 files (980 B), nothing earlier to compare with.');
    expect(
      describeBundleDiff({
        ...ok,
        status: 'target_unavailable',
        unavailableReason: 'encrypted',
        summary: null,
      }),
    ).toBe('Cannot list the files of 1.4.2: it is encrypted.');
    expect(
      describeBundleDiff({
        ...ok,
        status: 'base_unavailable',
        unavailableReason: 'unreadable',
        summary: null,
      }),
    ).toBe('Cannot compare 1.4.2 with 1.4.1: its files could not be read.');
  });

  it('formats sizes', () => {
    expect([980, 1536, 5 * 1024 * 1024].map(formatBundleBytes)).toEqual([
      '980 B',
      '1.5 KB',
      '5.0 MB',
    ]);
  });
});
