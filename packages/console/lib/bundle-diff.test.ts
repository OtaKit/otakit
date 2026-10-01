import { describe, expect, it } from 'vitest';

import { bundleWarnings, diffFileLists, downloadBytes } from './bundle-diff';
import type { BundleFileList } from './bundle-files';

const MB = 1024 * 1024;

function list(
  hashType: 'sha256' | 'crc32',
  files: Array<[string, number, string]>,
): BundleFileList {
  return { hashType, files: files.map(([path, size, hash]) => ({ path, size, hash })) };
}

describe('diffFileLists', () => {
  it('finds added, changed, removed and unchanged files', () => {
    const base = list('sha256', [
      ['index.html', 100, 'a'],
      ['assets/app.js', 1000, 'b'],
      ['assets/old.css', 50, 'c'],
      ['logo.svg', 20, 'd'],
    ]);
    const target = list('sha256', [
      ['index.html', 100, 'a'],
      ['assets/app.js', 1200, 'e'],
      ['assets/new.css', 60, 'f'],
      ['logo.svg', 20, 'g'],
    ]);
    expect(diffFileLists(base, target)).toEqual({
      comparable: true,
      changes: [
        { path: 'assets/new.css', status: 'added', sizeBefore: null, sizeAfter: 60 },
        { path: 'assets/app.js', status: 'changed', sizeBefore: 1000, sizeAfter: 1200 },
        // Same size, different content.
        { path: 'logo.svg', status: 'changed', sizeBefore: 20, sizeAfter: 20 },
        { path: 'assets/old.css', status: 'removed', sizeBefore: 50, sizeAfter: null },
      ],
      added: 1,
      removed: 1,
      changed: 2,
      unchanged: 1,
      totalBefore: 1170,
      totalAfter: 1380,
    });
  });

  it('compares zip with delta bundles by size only', () => {
    const base = list('crc32', [
      ['index.html', 100, '0000abcd'],
      ['app.js', 10, '00001234'],
    ]);
    const target = list('sha256', [
      ['index.html', 100, 'f'.repeat(64)],
      ['app.js', 12, 'e'.repeat(64)],
    ]);
    expect(diffFileLists(base, target)).toMatchObject({
      comparable: false,
      changes: [{ path: 'app.js', status: 'changed' }],
      unchanged: 1,
    });
  });

  it('treats every file as added without a base', () => {
    const diff = diffFileLists(null, list('crc32', [['index.html', 5, '1']]));
    expect(diff).toMatchObject({ added: 1, totalBefore: null, totalAfter: 5, comparable: true });
  });
});

describe('downloadBytes', () => {
  const base = list('sha256', [
    ['index.html', 100, 'a'],
    ['app.js', 1000, 'b'],
  ]);
  const target = list('sha256', [
    ['index.html', 100, 'a'],
    ['app.js', 1200, 'c'],
    ['copy-of-app.js', 1200, 'c'],
    ['moved.html', 100, 'a'],
  ]);

  it('counts only content a delta device does not have yet, once per hash', () => {
    expect(
      downloadBytes(
        { strategy: 'deltas', list: base },
        { strategy: 'deltas', size: 2600, list: target },
      ),
    ).toBe(1200);
  });

  it('is the archive size for zip updates and unknown after a zip bundle', () => {
    expect(
      downloadBytes(
        { strategy: 'deltas', list: base },
        { strategy: 'zip', size: 900, list: target },
      ),
    ).toBe(900);
    expect(
      downloadBytes(
        { strategy: 'zip', list: list('crc32', []) },
        { strategy: 'deltas', size: 2600, list: target },
      ),
    ).toBeNull();
    expect(downloadBytes(null, { strategy: 'deltas', size: 2600, list: target })).toBeNull();
  });
});

describe('bundleWarnings', () => {
  it('flags secrets, repositories and build folders as warnings, the rest as notes', () => {
    const target = list('crc32', [
      ['index.html', 10, '1'],
      ['.env.production', 10, '2'],
      ['config/.env', 10, '3'],
      ['.git/config', 10, '4'],
      ['node_modules/lib/index.js', 10, '5'],
      ['assets/index-4f3a9c2b.js.map', 1.2 * MB, '6'],
      ['.DS_Store', 10, '7'],
      ['downloads/Setup.EXE', 10, '8'],
      ['assets/environment.js', 10, '9'],
    ]);
    const warnings = bundleWarnings(target, null);
    expect(warnings.map((item) => [item.code, item.severity, item.paths])).toEqual([
      ['env_file', 'warning', ['.env.production', 'config/.env']],
      ['git_directory', 'warning', ['.git/config']],
      ['node_modules', 'warning', ['node_modules/lib/index.js']],
      ['source_map', 'note', ['assets/index-4f3a9c2b.js.map']],
      ['dotfile', 'note', ['.DS_Store']],
      ['native_installer', 'note', ['downloads/Setup.EXE']],
    ]);
    expect(warnings[0]).toMatchObject({ count: 2, message: expect.stringContaining('secrets') });
  });

  it('does not note small bundles growing by a few kilobytes', () => {
    const base = list('crc32', [['index.html', 200 * 1024, '1']]);
    const target = list('crc32', [['index.html', 400 * 1024, '2']]);
    expect(bundleWarnings(target, diffFileLists(base, target))).toEqual([]);
  });

  it('notes large new files and a bundle that grew more than 20%', () => {
    const base = list('crc32', [['index.html', 4 * MB, '1']]);
    const target = list('crc32', [
      ['index.html', 4 * MB, '1'],
      ['assets/hero.png', 3 * MB, '2'],
    ]);
    const warnings = bundleWarnings(target, diffFileLists(base, target));
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'large_new_file', paths: ['assets/hero.png'], count: 1 }),
      expect.objectContaining({
        code: 'size_increase',
        message: 'The bundle grew by 75% (4.0 MB → 7.0 MB).',
      }),
    ]);
  });

  it('caps the example paths and stays quiet for a clean bundle', () => {
    const many = list(
      'crc32',
      Array.from(
        { length: 25 },
        (_, index) =>
          [`maps/${String(index).padStart(2, '0')}.js.map`, 1, '1'] as [string, number, string],
      ),
    );
    const [maps] = bundleWarnings(many, null);
    expect(maps.paths).toHaveLength(10);
    expect(maps.count).toBe(25);
    expect(bundleWarnings(list('crc32', [['index.html', 1, '1']]), null)).toEqual([]);
  });
});
