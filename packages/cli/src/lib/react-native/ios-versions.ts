import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const keys = ['CFBundleVersion', 'CFBundleShortVersionString'] as const;
export type IOSVersions = Record<(typeof keys)[number], string>;

/** Resolve the source plist, not Xcode's unrelated default marketing version. */
export function resolveIOSVersions(
  plist: Record<string, unknown>,
  settings: Record<string, string>,
): IOSVersions {
  if (
    settings.INFOPLIST_PREPROCESS === 'YES' ||
    keys.some((key) => settings[`INFOPLIST_KEY_${key}`])
  )
    throw new Error('Custom Info.plist version preprocessing/overrides need explicit support');
  return Object.fromEntries(
    keys.map((key) => {
      const source = plist[key];
      if (typeof source !== 'string' || !source)
        throw new Error(`Missing source Info.plist ${key}`);
      let value = source;
      if (settings.INFOPLIST_EXPAND_BUILD_SETTINGS !== 'NO')
        value = value.replace(/\$\((\w+)\)|\$\{(\w+)\}/g, (_match, first, second) => {
          const replacement = settings[first ?? second];
          if (!replacement)
            throw new Error(`Unresolved Info.plist version setting: ${first ?? second}`);
          return replacement;
        });
      if (value.includes('$')) throw new Error(`Unsupported Info.plist version expression: ${key}`);
      return [key, value];
    }),
  ) as IOSVersions;
}

export async function readIOSVersions(settings: Record<string, string>) {
  if (!settings.INFOPLIST_FILE)
    throw new Error('Record versions in a source Info.plist before using the iOS build hook');
  const file = await realpath(
    resolve(settings.SRCROOT || settings.PROJECT_DIR, settings.INFOPLIST_FILE),
  );
  const { stdout } = await promisify(execFile)(
    '/usr/bin/plutil',
    ['-convert', 'json', '-o', '-', file],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  return { file, versions: resolveIOSVersions(JSON.parse(stdout), settings) };
}
