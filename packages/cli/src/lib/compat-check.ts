import { isActiveRollout, type ApiClient, type Release } from './api.js';
import { compareNative, type CompatibilityResult, type NativePackage } from './native-deps.js';

/**
 * A release lane as the CLI can see it: the current release, the stable
 * release every device outside an active rollout runs (the one below a
 * rolling release), and whether the fetched history covered the whole channel.
 */
export type LaneState = {
  current: Release | null;
  stable: Release | null;
  complete: boolean;
};

export async function findLaneState(
  api: Pick<ApiClient, 'listReleases'>,
  channel: string | null,
  runtimeVersion: string | undefined,
): Promise<LaneState> {
  // 200 is the API's max page size. When the channel has more releases, a
  // lane whose current release sits deeper is reported as unknown, not empty.
  const { releases, total } = await api.listReleases(channel, { limit: 200 });
  const lane = runtimeVersion ?? null;
  const [current = null, below = null] = releases.filter(
    (release) => !release.revertedAt && (release.runtimeVersion ?? null) === lane,
  );
  return {
    current,
    stable: current && isActiveRollout(current) ? below : current,
    complete: releases.length >= total,
  };
}

/**
 * Compare the local native set against the bundle of the lane's stable
 * release: the one most devices run, and the one a new release falls back
 * to. It is looked up unless already known.
 *
 * Returns `skipped` when the lane has no release or the bundle predates
 * native package capture.
 */
export async function checkCompatibilityAgainstChannel(options: {
  api: ApiClient;
  channel: string | null;
  runtimeVersion: string | undefined;
  nativePackages: NativePackage[];
  baseline?: Release | null;
}): Promise<CompatibilityResult> {
  const { api, channel, runtimeVersion, nativePackages } = options;

  const baseline =
    options.baseline === undefined
      ? (await findLaneState(api, channel, runtimeVersion)).stable
      : options.baseline;
  if (!baseline) {
    return { status: 'skipped', findings: [] };
  }

  const bundle = await api.getBundle(baseline.bundleId);
  const remote = bundle.nativePackages;
  if (remote === null || remote === undefined) {
    return { status: 'skipped', findings: [] };
  }

  return compareNative(nativePackages, remote);
}
