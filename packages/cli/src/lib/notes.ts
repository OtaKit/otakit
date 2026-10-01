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
  return notes === '' ? undefined : notes;
}
