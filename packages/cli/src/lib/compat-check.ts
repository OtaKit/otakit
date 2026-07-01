import type { ApiClient } from './api.js';
import { compareNative, type CompatibilityResult, type NativePackage } from './native-deps.js';

/**
 * Resolve the channel's current (non-reverted) release in the same
 * runtimeVersion lane and compare the local native set against its bundle.
 *
 * Returns `skipped` when the channel has no current release in this lane or
 * the current bundle predates native package capture.
 */
export async function checkCompatibilityAgainstChannel(options: {
  api: ApiClient;
  channel: string | null;
  runtimeVersion: string | undefined;
  nativePackages: NativePackage[];
}): Promise<CompatibilityResult> {
  const { api, channel, runtimeVersion, nativePackages } = options;

  const { releases } = await api.listReleases(channel, { limit: 50 });
  const lane = runtimeVersion ?? null;
  const currentRelease = releases.find(
    (release) => !release.revertedAt && (release.runtimeVersion ?? null) === lane,
  );
  if (!currentRelease) {
    return { status: 'skipped', findings: [] };
  }

  const bundle = await api.getBundle(currentRelease.bundleId);
  const remote = bundle.nativePackages;
  if (remote === null || remote === undefined) {
    return { status: 'skipped', findings: [] };
  }

  return compareNative(nativePackages, remote);
}
