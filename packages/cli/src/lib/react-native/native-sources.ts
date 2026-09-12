import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { canonicalJSON } from '@otakit/rn-protocol';
import { hashFile } from '../hash.js';

// Kotlin session markers disappear when Gradle exits. They are generated compiler state,
// just like the .gradle/.cxx directories already excluded by the upstream fingerprint.
export const RN_FINGERPRINT_IGNORES = ['**/android/.kotlin/**/*', '**/android/app/.kotlin/**/*'];

/** Supplement explicit native sources skipped by upstream CNG/pnpm ignore rules. */
export async function hashResolvedNativeSource(
  project: string,
  source: string,
  resourceDirectory: string,
) {
  if (!/^[A-Za-z0-9_-]+$/.test(resourceDirectory))
    throw new Error('A single generated OtaKit resource directory name is required');
  const projectRoot = await realpath(project);
  const root = await realpath(source);
  if (!(await lstat(root)).isDirectory())
    throw new Error(`Resolved native source is not a directory: ${source}`);
  const files: Array<{ path: string; sha256: string }> = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        [
          'node_modules',
          '.git',
          '.gradle',
          '.cxx',
          '.kotlin',
          '.swiftpm',
          '.build',
          'build',
          'Pods',
          'DerivedData',
          'xcuserdata',
        ].includes(entry.name)
      )
        continue;
      if (['.DS_Store', '.xcode.env.local', 'local.properties'].includes(entry.name)) continue;
      const file = join(directory, entry.name);
      // Only the app's configured generated resource directory is self-referential.
      const appPath = relative(projectRoot, file).split(sep).join('/');
      if (
        entry.name === resourceDirectory &&
        (appPath.startsWith('ios/') ||
          appPath === `android/app/src/main/assets/${resourceDirectory}`)
      )
        continue;
      if (entry.isSymbolicLink()) throw new Error(`Unresolved symlink in native source: ${file}`);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        if (files.length >= 25000)
          throw new Error(`Resolved native source exceeds file limit: ${source}`);
        files.push({
          path: relative(root, file).split(sep).join('/'),
          sha256: await hashFile(file),
        });
      } else throw new Error(`Unsupported native source entry: ${file}`);
    }
  }
  await walk(root);
  if (!files.length) throw new Error(`Resolved native source is empty: ${source}`);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    path: relative(projectRoot, root).split(sep).join('/'),
    fileCount: files.length,
    sha256: createHash('sha256').update(canonicalJSON(files)).digest('hex'),
  };
}
