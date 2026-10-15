import { describe, expect, it } from 'vitest';

import {
  AGENT_LISTED_CHANGES,
  bundleDiffEnvelopeParts,
  describeBundleDiff,
  formatBundleBytes,
  printablePath,
} from './bundle-diff';

const ok = {
  target: { version: '1.4.2', strategy: 'deltas' },
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
      '1.4.2 vs 1.4.1: +3 ~12 -1 · 4.1 MB → 4.3 MB · devices on 1.4.1 download up to 38.0 KB',
    );
    expect(
      describeBundleDiff({
        ...ok,
        target: { version: '1.4.2', strategy: 'zip' },
        baseSource: 'previous_upload',
        summary: { ...ok.summary, downloadBytes: 1.2 * 1024 * 1024 },
      }),
    ).toBe(
      '1.4.2 vs 1.4.1 (previous upload): +3 ~12 -1 · 4.1 MB → 4.3 MB · devices download 1.2 MB, the whole archive',
    );
    expect(
      describeBundleDiff({
        ...ok,
        comparable: false,
        summary: { ...ok.summary, downloadBytes: null },
      }),
    ).toBe(
      '1.4.2 vs 1.4.1: +3 ~12 -1 · 4.1 MB → 4.3 MB · devices download up to the full bundle; compared by size, as one bundle is zip and the other deltas',
    );
  });

  it('names the channel it compared with', () => {
    expect(describeBundleDiff({ ...ok, baseSource: 'channel', baseChannel: 'production' })).toMatch(
      /^1\.4\.2 vs production \(1\.4\.1\): /,
    );
    expect(describeBundleDiff({ ...ok, baseSource: 'channel', baseChannel: null })).toMatch(
      /^1\.4\.2 vs base \(1\.4\.1\): /,
    );
    expect(
      describeBundleDiff({ ...ok, baseSource: 'channel_previous', baseChannel: 'production' }),
    ).toMatch(/^1\.4\.2 vs 1\.4\.1 \(what production ran before it\): /);
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

  it('escapes control and bidirectional characters in file names', () => {
    expect(printablePath('ok/path.js')).toBe('ok/path.js');
    expect(printablePath('a\u001b[31mred\u0007')).toBe('a\\u001b[31mred\\u0007');
    expect(printablePath('invoice\u202efdp.exe')).toBe('invoice\\u202efdp.exe');
    expect(printablePath('line\u2028break')).toBe('line\\u2028break');
  });

  it('gives agents the first files, printable names and the real warnings', () => {
    const changes = Array.from({ length: 250 }, (_, index) => ({
      path: index === 0 ? 'bad\u001bname.js' : `file-${index}.js`,
      status: 'added' as const,
    }));
    const parts = bundleDiffEnvelopeParts({
      ...ok,
      changes,
      unlistedChanges: 10,
      warnings: [
        {
          severity: 'warning' as const,
          message: 'Environment files (.env) often hold secrets.',
          paths: ['.env', '.env\u0007'],
          count: 4,
        },
        { severity: 'note' as const, message: 'The bundle grew.', paths: [], count: 0 },
      ],
    });
    expect(parts.data.changes).toHaveLength(AGENT_LISTED_CHANGES);
    expect(parts.data.changes[0].path).toBe('bad\\u001bname.js');
    expect(parts.data.unlistedChanges).toBe(160);
    expect(parts.summary).toContain(
      'Lists the first 100 of 260 changed files; `otakit diff --json` and the REST API return up to 5,000.',
    );
    expect(parts.warnings).toEqual([
      'Environment files (.env) often hold secrets. .env, .env\\u0007 and 2 more',
    ]);
    expect(parts.data.warnings[0].paths).toEqual(['.env', '.env\\u0007']);
  });

  it('formats sizes', () => {
    expect([980, 1536, 5 * 1024 * 1024].map(formatBundleBytes)).toEqual([
      '980 B',
      '1.5 KB',
      '5.0 MB',
    ]);
  });
});
