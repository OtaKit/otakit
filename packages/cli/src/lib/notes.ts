import { readFile } from 'node:fs/promises';

import { CliError } from './errors.js';

export const MAX_RELEASE_NOTES_LENGTH = 2000;

/**
 * Release notes from `--notes` or `--notes-file`, normalised like the server
 * does (line endings, trimmed). Undefined when neither flag is set or the text
 * is empty.
 */
export async function readReleaseNotes(options: {
  notes?: string;
  notesFile?: string;
}): Promise<string | undefined> {
  if (options.notes !== undefined && options.notesFile !== undefined) {
    throw new CliError('Use either --notes or --notes-file, not both.');
  }
  let text = options.notes;
  if (options.notesFile !== undefined) {
    try {
      text = await readFile(options.notesFile, 'utf8');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new CliError(`Could not read --notes-file ${options.notesFile}: ${reason}`);
    }
  }
  if (text === undefined) return undefined;
  const notes = text.replace(/\r\n?/g, '\n').trim();
  if (notes.length > MAX_RELEASE_NOTES_LENGTH) {
    throw new CliError(
      `Release notes must be at most ${MAX_RELEASE_NOTES_LENGTH.toLocaleString('en-US')} characters (got ${notes.length.toLocaleString('en-US')}).`,
    );
  }
  if (notes.includes('\u0000')) {
    throw new CliError('Release notes must not contain null characters.');
  }
  return notes === '' ? undefined : notes;
}

/** ' with release notes' when the server stored notes on the release. */
export function notesLabel(release: { notes?: string | null }): string {
  return release.notes ? ' with release notes' : '';
}

/** Warn when notes were sent but the server did not store them (no notes support yet). */
export function warnIfNotesDropped(
  sent: string | undefined,
  release: { notes?: string | null },
): void {
  if (sent !== undefined && !release.notes) {
    console.warn(
      'Warning: the server did not store the release notes; it may not support them yet.',
    );
  }
}
