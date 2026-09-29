import type { ApiClient, Release } from './api.js';
import { compareNative, type CompatibilityResult, type NativePackage } from './native-deps.js';

/** The channel's current (non-reverted) release in the given runtimeVersion lane. */
export async function findCurrentLaneRelease(
  api: Pick<ApiClient, 'listReleases'>,
  channel: string | null,
  runtimeVersion: string | undefined,
): Promise<Release | null> {
  // 200 is the API's max page size; a lane whose current release sits deeper
  // than 200 releases back is treated as having none.
  const { releases } = await api.listReleases(channel, { limit: 200 });
  const lane = runtimeVersion ?? null;
  return (
    releases.find((release) => !release.revertedAt && (release.runtimeVersion ?? null) === lane) ??
    null
  );
}

/**
 * Compare the local native set against the bundle of the channel's current
 * release in the same runtimeVersion lane (looked up unless already known).
 *
 * Returns `skipped` when the channel has no current release in this lane or
 * the current bundle predates native package capture.
 */
export async function checkCompatibilityAgainstChannel(options: {
  api: ApiClient;
  channel: string | null;
  runtimeVersion: string | undefined;
  nativePackages: NativePackage[];
  currentRelease?: Release | null;
}): Promise<CompatibilityResult> {
  const { api, channel, runtimeVersion, nativePackages } = options;

  const currentRelease =
    options.currentRelease === undefined
      ? await findCurrentLaneRelease(api, channel, runtimeVersion)
      : options.currentRelease;
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
