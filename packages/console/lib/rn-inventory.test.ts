import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/storage', () => ({ getMaxBundleSize: () => 100_000 }));

import { parseDeltaFiles } from './delta-files';
import { parseRNInventory } from './rn-inventory';

const file = (path: string, size = 1) => ({
  path,
  size,
  sha256: 'a'.repeat(64),
  md5: 'a'.repeat(22) + '==',
});
const required = [file('index.bundle'), file('otakit-bundle.json')];

describe('RN portable inventory', () => {
  it.each([
    ['duplicate', ['a', 'a']],
    ['file/directory', ['a', 'a/b']],
    ['directory/file', ['a/b', 'a']],
    ['directory casing', ['Icons/a.png', 'icons/b.png']],
    ['canonical Unicode', ['é.png', 'e\u0301.png']],
    ['full case folding', ['Straße.png', 'STRASSE.png']],
    ['Greek sigma', ['σ.png', 'ς.png']],
    ['reserved metadata', ['BUNDLE.JSON']],
    ['reserved delta metadata', ['OTAKIT_FILES.JSON']],
    ['reserved embedded receipt directory', ['OTAKIT-EMBEDDED.JSON/child']],
    ['parent traversal', ['a/../b']],
    ['absolute path', ['/index.bundle']],
    ['empty component', ['a//b']],
    ['backslash', ['a\\b']],
    ['control character', ['a\nb']],
    ['unpaired surrogate', ['\ud800.png']],
    ['component bytes', ['é'.repeat(126) + '.png']],
    ['path bytes', ['a'.repeat(255) + '/' + 'b'.repeat(255) + '/c']],
  ])('rejects %s', (_, paths) => {
    expect(parseRNInventory([...required, ...paths.map((path) => file(path))], 100_000).ok).toBe(
      false,
    );
  });

  it('preserves accepted spelling and accepts the exact byte budgets', () => {
    const path = 'é'.repeat(125) + '.png';
    const files = [...required, file(path), file('a'.repeat(254) + '/' + 'b'.repeat(255) + '/c')];
    const parsed = parseRNInventory(files, 100_000);
    expect(parsed.ok).toBe(true);
    if (parsed.ok)
      expect(parsed.files.map((entry) => entry.path)).toEqual(files.map((entry) => entry.path));
  });

  it('requires nonempty native entrypoints and bounds inventory sizes', () => {
    expect(parseRNInventory([file('index.html'), file('other')], 100).ok).toBe(false);
    expect(parseRNInventory([file('index.bundle', 0), file('otakit-bundle.json')], 100).ok).toBe(
      false,
    );
    expect(parseRNInventory(required, 1).ok).toBe(false);
    expect(
      parseRNInventory([...required, file('x', Number.MAX_SAFE_INTEGER + 1)], Infinity).ok,
    ).toBe(false);
    expect(
      parseRNInventory(
        [...required, ...Array.from({ length: 4999 }, (_, i) => file(`${i}`))],
        100_000,
      ).ok,
    ).toBe(false);
  });

  it('keeps MD5 requirements for RN delta uploads and accepts ZIP inventories without MD5', () => {
    const files = required.map(({ path, sha256, size }) => ({ path, sha256, size }));
    expect(parseRNInventory(files, 100).ok).toBe(true);
    expect(parseDeltaFiles(files, 'react_native').ok).toBe(false);
    expect(parseDeltaFiles(required, 'react_native').ok).toBe(true);
  });

  it('preserves the existing Capacitor entrypoint and character-based path rules', () => {
    expect(parseDeltaFiles(required).ok).toBe(false);
    expect(
      parseDeltaFiles([file('index.html'), file('é'.repeat(140) + '.png'), file('BUNDLE.JSON')]).ok,
    ).toBe(true);
    expect(parseDeltaFiles([file('index.html'), file('bundle.json')]).ok).toBe(false);
  });
});
