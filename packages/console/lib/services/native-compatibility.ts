import semver from 'semver';

export type NativePackage = {
  name: string;
  version: string;
  requestedVersion?: string;
  iosChecksum?: string;
  androidChecksum?: string;
};

export type CompatibilityFinding = {
  name: string;
  kind:
    | 'new_plugin'
    | 'native_code_changed'
    | 'version_mismatch'
    | 'range_changed'
    | 'removed'
    | 'unchanged';
  incompatible: boolean;
  localVersion?: string;
  remoteVersion?: string;
  note?: string;
};

export type NativeCompatibilityResult = {
  status: 'compatible' | 'incompatible' | 'skipped';
  reason?:
    | 'target_missing_metadata'
    | 'current_release_missing_metadata'
    | 'no_target_native_packages'
    | 'explicitly_skipped';
  findings: CompatibilityFinding[];
};

function nativePackages(value: unknown): NativePackage[] | null {
  if (!Array.isArray(value)) return null;
  const packages: NativePackage[] = [];
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as Record<string, unknown>).name !== 'string' ||
      typeof (entry as Record<string, unknown>).version !== 'string'
    ) {
      return null;
    }
    const record = entry as Record<string, unknown>;
    packages.push({
      name: record.name as string,
      version: record.version as string,
      ...(typeof record.requestedVersion === 'string'
        ? { requestedVersion: record.requestedVersion }
        : {}),
      ...(typeof record.iosChecksum === 'string' ? { iosChecksum: record.iosChecksum } : {}),
      ...(typeof record.androidChecksum === 'string'
        ? { androidChecksum: record.androidChecksum }
        : {}),
    });
  }
  return packages;
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

function compareEntry(local: NativePackage, remote: NativePackage): CompatibilityFinding {
  const base = {
    name: local.name,
    localVersion: local.version,
    remoteVersion: remote.version,
  };
  const addedPlatforms = [
    ['ios', local.iosChecksum, remote.iosChecksum],
    ['android', local.androidChecksum, remote.androidChecksum],
  ].filter(([, localSum, remoteSum]) => localSum !== undefined && remoteSum === undefined);
  if (addedPlatforms.length > 0) {
    return {
      ...base,
      kind: 'native_code_changed',
      incompatible: true,
      note: `native code added for ${addedPlatforms.map(([platform]) => platform).join(' + ')}`,
    };
  }

  const comparable = [
    [local.iosChecksum, remote.iosChecksum],
    [local.androidChecksum, remote.androidChecksum],
  ].filter(([left, right]) => left !== undefined && right !== undefined) as Array<[string, string]>;
  if (comparable.length > 0) {
    if (comparable.some(([left, right]) => left !== right)) {
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
        note: 'requested range changed but native code is identical',
      };
    }
    return { ...base, kind: 'unchanged', incompatible: false };
  }

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

export function compareBundleNativePackages(
  targetValue: unknown,
  currentValue: unknown,
): NativeCompatibilityResult {
  const target = nativePackages(targetValue);
  if (!target) {
    return { status: 'skipped', reason: 'target_missing_metadata', findings: [] };
  }
  const current = nativePackages(currentValue);
  if (!current) {
    return { status: 'skipped', reason: 'current_release_missing_metadata', findings: [] };
  }

  // An empty target set makes every current package look like a safe removal.
  // That is a real outcome only if the app genuinely dropped all native code;
  // far more often the uploading CLI scanned the wrong directory. Refuse to
  // call it compatible rather than clearing a release on absent evidence.
  if (target.length === 0 && current.length > 0) {
    return { status: 'skipped', reason: 'no_target_native_packages', findings: [] };
  }

  const currentByName = new Map(current.map((entry) => [entry.name, entry]));
  const findings: CompatibilityFinding[] = [];
  for (const pkg of target) {
    const currentPackage = currentByName.get(pkg.name);
    currentByName.delete(pkg.name);
    findings.push(
      currentPackage
        ? compareEntry(pkg, currentPackage)
        : {
            name: pkg.name,
            kind: 'new_plugin',
            incompatible: true,
            localVersion: pkg.version,
            note: 'native plugin is absent from the current release',
          },
    );
  }
  for (const pkg of currentByName.values()) {
    findings.push({
      name: pkg.name,
      kind: 'removed',
      incompatible: false,
      remoteVersion: pkg.version,
      note: 'removed from the target bundle',
    });
  }
  return {
    status: findings.some((finding) => finding.incompatible) ? 'incompatible' : 'compatible',
    findings,
  };
}
