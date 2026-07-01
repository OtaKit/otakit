import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import semver from 'semver';

import { CliError } from './errors.js';

/**
 * A dependency that ships native (iOS/Android) code, captured at upload time
 * so later uploads can detect native changes that require a store build.
 */
export interface NativePackage {
  name: string;
  version: string;
  requestedVersion?: string;
  iosChecksum?: string;
  androidChecksum?: string;
}

export interface CollectNativePackagesOptions {
  /** Path to the project package.json. Defaults to ./package.json. */
  packageJsonPath?: string;
  /** Path to the resolved node_modules. Defaults to a sibling of package.json. */
  nodeModulesPath?: string;
}

const NATIVE_FILE_REGEX = /\.(java|swift|kt|scala)$/;
const IOS_SOURCE_REGEX = /\.swift$/;
const ANDROID_SOURCE_REGEX = /\.(java|kt|scala)$/;
const IOS_CONFIG_REGEX = /(\.podspec|(^|\/)Package\.swift)$/;
const ANDROID_CONFIG_REGEX = /(^|\/)build\.gradle(\.kts)?$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build']);

export function collectNativePackages(options: CollectNativePackagesOptions = {}): NativePackage[] {
  const packageJsonPath = resolve(options.packageJsonPath ?? join(process.cwd(), 'package.json'));
  if (!existsSync(packageJsonPath)) {
    throw new CliError(`package.json not found at ${packageJsonPath} (use --package-json).`);
  }

  const nodeModulesPath = resolve(
    options.nodeModulesPath ?? join(dirname(packageJsonPath), 'node_modules'),
  );
  if (!existsSync(nodeModulesPath)) {
    throw new CliError(`node_modules not found at ${nodeModulesPath} (use --node-modules).`);
  }

  const rootPackage = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
    dependencies?: Record<string, string>;
  };
  const dependencies = rootPackage.dependencies ?? {};

  const nativePackages: NativePackage[] = [];
  for (const [name, requestedVersion] of Object.entries(dependencies)) {
    const packageDir = join(nodeModulesPath, ...name.split('/'));
    const packageJson = join(packageDir, 'package.json');
    if (!existsSync(packageJson)) {
      continue;
    }

    let installedVersion: string;
    try {
      const parsed = JSON.parse(readFileSync(packageJson, 'utf-8')) as { version?: unknown };
      if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
        continue;
      }
      installedVersion = parsed.version;
    } catch {
      continue;
    }

    const files = listFilesRecursively(packageDir);
    const relativePaths = files
      .map((file) => relative(packageDir, file).split(sep).join('/'))
      .sort();

    if (!relativePaths.some((path) => NATIVE_FILE_REGEX.test(path))) {
      continue;
    }

    const iosChecksum = checksumForPlatform(
      packageDir,
      relativePaths,
      IOS_SOURCE_REGEX,
      IOS_CONFIG_REGEX,
    );
    const androidChecksum = checksumForPlatform(
      packageDir,
      relativePaths,
      ANDROID_SOURCE_REGEX,
      ANDROID_CONFIG_REGEX,
    );

    nativePackages.push({
      name,
      version: installedVersion,
      requestedVersion,
      ...(iosChecksum ? { iosChecksum } : {}),
      ...(androidChecksum ? { androidChecksum } : {}),
    });
  }

  return nativePackages.sort((a, b) => a.name.localeCompare(b.name));
}

function listFilesRecursively(directory: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...listFilesRecursively(fullPath));
      }
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * SHA-256 over the platform's sorted native + config files, with each file's
 * relative path mixed into the hash so renames are detected.
 */
function checksumForPlatform(
  packageDir: string,
  sortedRelativePaths: string[],
  sourceRegex: RegExp,
  configRegex: RegExp,
): string | undefined {
  const platformPaths = sortedRelativePaths.filter(
    (path) => sourceRegex.test(path) || configRegex.test(path),
  );
  if (platformPaths.length === 0) {
    return undefined;
  }

  const hash = createHash('sha256');
  for (const path of platformPaths) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(join(packageDir, path)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export type CompatibilityStatus = 'compatible' | 'incompatible' | 'skipped';

export type FindingKind =
  | 'new_plugin'
  | 'native_code_changed'
  | 'version_mismatch'
  | 'range_changed'
  | 'removed'
  | 'unchanged';

export interface CompatibilityFinding {
  name: string;
  kind: FindingKind;
  incompatible: boolean;
  localVersion?: string;
  remoteVersion?: string;
  note?: string;
}

export interface CompatibilityResult {
  status: CompatibilityStatus;
  findings: CompatibilityFinding[];
}

/**
 * Compare the local native set against the channel's current bundle.
 *
 * The checksum is the authoritative "native code actually changed" signal;
 * a changed requested-version range that resolves to identical native code
 * is reported as informational only.
 */
export function compareNative(
  local: NativePackage[],
  remote: NativePackage[] | null | undefined,
): CompatibilityResult {
  if (remote === null || remote === undefined) {
    return { status: 'skipped', findings: [] };
  }

  const remoteByName = new Map(remote.map((entry) => [entry.name, entry]));
  const findings: CompatibilityFinding[] = [];

  for (const pkg of local) {
    const remotePkg = remoteByName.get(pkg.name);
    remoteByName.delete(pkg.name);

    if (!remotePkg) {
      findings.push({
        name: pkg.name,
        kind: 'new_plugin',
        incompatible: true,
        localVersion: pkg.version,
        note: 'native plugin not present in the current release',
      });
      continue;
    }

    findings.push(compareEntry(pkg, remotePkg));
  }

  for (const remotePkg of remoteByName.values()) {
    findings.push({
      name: remotePkg.name,
      kind: 'removed',
      incompatible: false,
      remoteVersion: remotePkg.version,
      note: 'removed locally (safe to ship OTA)',
    });
  }

  const status = findings.some((finding) => finding.incompatible) ? 'incompatible' : 'compatible';
  return { status, findings };
}

function compareEntry(local: NativePackage, remote: NativePackage): CompatibilityFinding {
  const base = {
    name: local.name,
    localVersion: local.version,
    remoteVersion: remote.version,
  };

  const comparablePlatforms: Array<[string | undefined, string | undefined]> = [
    [local.iosChecksum, remote.iosChecksum],
    [local.androidChecksum, remote.androidChecksum],
  ].filter(([localSum, remoteSum]) => localSum !== undefined && remoteSum !== undefined) as Array<
    [string, string]
  >;

  if (comparablePlatforms.length > 0) {
    const changed = comparablePlatforms.some(([localSum, remoteSum]) => localSum !== remoteSum);
    if (changed) {
      return {
        ...base,
        kind: 'native_code_changed',
        incompatible: true,
        note: 'native code differs from the current release',
      };
    }
    if (local.requestedVersion !== remote.requestedVersion) {
      return {
        ...base,
        kind: 'range_changed',
        incompatible: false,
        note: `requested range changed (${remote.requestedVersion ?? '?'} -> ${local.requestedVersion ?? '?'}) but native code is identical`,
      };
    }
    return { ...base, kind: 'unchanged', incompatible: false };
  }

  // No comparable checksums (older baseline data) — fall back to versions.
  if (!versionsIntersect(local, remote)) {
    return {
      ...base,
      kind: 'version_mismatch',
      incompatible: true,
      note: 'installed native versions do not intersect',
    };
  }
  return { ...base, kind: 'unchanged', incompatible: false };
}

function versionsIntersect(local: NativePackage, remote: NativePackage): boolean {
  const localRange = local.requestedVersion ?? local.version;
  const remoteRange = remote.requestedVersion ?? remote.version;
  try {
    return semver.intersects(localRange, remoteRange, { includePrerelease: true });
  } catch {
    return local.version === remote.version;
  }
}

export function formatCompatibilityReport(result: CompatibilityResult): string {
  if (result.status === 'skipped') {
    return 'Compatibility check skipped: the current release has no native package baseline yet.';
  }

  const lines: string[] = [];
  const rows = result.findings.map((finding) => [
    finding.incompatible ? 'INCOMPATIBLE' : finding.kind === 'unchanged' ? 'ok' : 'info',
    finding.name,
    finding.localVersion ?? '-',
    finding.remoteVersion ?? '-',
    finding.note ?? finding.kind,
  ]);
  const header = ['status', 'package', 'local', 'remote', 'detail'];
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length)),
  );
  const renderRow = (row: string[]) =>
    row.map((cell, column) => cell.padEnd(widths[column])).join('  ');

  lines.push(renderRow(header));
  lines.push(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) {
    lines.push(renderRow(row));
  }
  if (rows.length === 0) {
    lines.push('(no native packages detected)');
  }

  if (result.status === 'incompatible') {
    lines.push('');
    lines.push(
      'These native changes require a new store build. Bump runtimeVersion and ship a native build before releasing this bundle OTA.',
    );
  }

  return lines.join('\n');
}
