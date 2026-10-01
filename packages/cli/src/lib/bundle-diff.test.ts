import { describe, expect, it } from 'vitest';

import type { BundleDiff } from './api.js';
import { formatBundleDiff } from './bundle-diff.js';

const diff: BundleDiff = {
  target: {
    id: 'b',
    version: '1.4.2',
    runtimeVersion: null,
    strategy: 'zip',
    size: 1,
    encrypted: false,
  },
  base: {
    id: 'a',
    version: '1.4.1',
    runtimeVersion: null,
    strategy: 'zip',
    size: 1,
    encrypted: false,
  },
  baseSource: 'previous_upload',
  status: 'ok',
  unavailableReason: null,
  comparable: true,
  summary: {
    added: 1,
    removed: 1,
    changed: 1,
    unchanged: 10,
    totalBefore: 2048,
    totalAfter: 3072,
    downloadBytes: 900,
  },
  changes: [
    { path: 'assets/new.js', status: 'added', sizeBefore: null, sizeAfter: 1024 },
    { path: 'assets/app.js', status: 'changed', sizeBefore: 1024, sizeAfter: 2048 },
    { path: 'assets/old.css', status: 'removed', sizeBefore: 100, sizeAfter: null },
  ],
  unlistedChanges: 0,
  warnings: [
    {
      code: 'env_file',
      severity: 'warning',
      message: 'Environment files (.env) often hold secrets.',
      paths: ['.env'],
      count: 1,
    },
    { code: 'size_increase', severity: 'note', message: 'The bundle grew.', paths: [], count: 0 },
  ],
};

describe('formatBundleDiff', () => {
  it('prints the summary, each changed file and the warnings', () => {
    expect(formatBundleDiff(diff)).toBe(
      [
        '1.4.2 vs 1.4.1: +1 ~1 -1 · 2.0 KB → 3.0 KB · devices download ≈ 900 B',
        '',
        '  + assets/new.js  (1.0 KB)',
        '  ~ assets/app.js  (1.0 KB → 2.0 KB)',
        '  - assets/old.css  (100 B)',
        '',
        'Warning: Environment files (.env) often hold secrets.',
        '  .env',
        '',
        'Note: The bundle grew.',
      ].join('\n'),
    );
  });

  it('says how many files it left out', () => {
    expect(formatBundleDiff({ ...diff, unlistedChanges: 7, warnings: [] }, 2)).toContain(
      '  … and 8 more (use --json for all)',
    );
  });
});
