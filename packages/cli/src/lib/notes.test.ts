import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readReleaseNotes } from './notes.js';

describe('release notes flags', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('normalises --notes like the server and drops empty notes', async () => {
    await expect(readReleaseNotes({ notes: '  Faster checkout.\r\nFixed upload. ' })).resolves.toBe(
      'Faster checkout.\nFixed upload.',
    );
    await expect(readReleaseNotes({ notes: '   ' })).resolves.toBeUndefined();
    await expect(readReleaseNotes({})).resolves.toBeUndefined();
  });

  it('reads --notes-file and refuses both flags together', async () => {
    dir = await mkdtemp(join(tmpdir(), 'otakit-notes-'));
    const file = join(dir, 'NOTES.md');
    await writeFile(file, 'Line one\nLine two\n');

    await expect(readReleaseNotes({ notesFile: file })).resolves.toBe('Line one\nLine two');
    await expect(readReleaseNotes({ notes: 'x', notesFile: file })).rejects.toThrow(
      'either --notes or --notes-file',
    );
    await expect(readReleaseNotes({ notesFile: join(dir, 'missing.md') })).rejects.toThrow(
      'Could not read --notes-file',
    );
  });

  it('refuses notes over 2,000 characters', async () => {
    await expect(readReleaseNotes({ notes: 'x'.repeat(2000) })).resolves.toHaveLength(2000);
    await expect(readReleaseNotes({ notes: 'x'.repeat(2001) })).rejects.toThrow(
      'at most 2,000 characters',
    );
  });
});
