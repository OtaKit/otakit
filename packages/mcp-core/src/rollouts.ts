type LaneRelease = { bundleVersion?: string; rolloutPercent?: number } | null | undefined;

/** " to 10% of devices" for a rollout; empty when the release reaches every device. */
export function rolloutShareText(percent: number | undefined): string {
  return percent !== undefined && percent < 100 ? ` to ${percent}% of devices` : '';
}

/** The summary line for a rollout percentage change. */
export function rolloutChangeSummary(result: {
  publicationStatus: string;
  previousPercent: number;
  release: { bundleVersion?: string; rolloutPercent?: number };
}): string {
  const version = result.release.bundleVersion ?? 'the release';
  if (result.publicationStatus === 'manifest_sync_pending') {
    return 'Rollout change is recorded, but manifest synchronization is pending.';
  }
  return result.release.rolloutPercent === 100
    ? `Completed the rollout of ${version}; every device now receives it.`
    : `Rollout of ${version} changed from ${result.previousPercent}% to ${result.release.rolloutPercent}%.`;
}

/** Rollout consequences a reviewer must see before approving a publish. */
export function rolloutWarnings(
  currentRelease: LaneRelease,
  options: { rolloutPercent?: number; replaceRollout?: boolean },
): string[] {
  const warnings: string[] = [];
  const currentPercent = currentRelease?.rolloutPercent ?? 100;
  if (currentRelease && currentPercent < 100) {
    const version = currentRelease.bundleVersion ?? 'The current release';
    warnings.push(
      options.replaceRollout
        ? `Publishing reverts the active rollout of ${version} (${currentPercent}%) and releases this bundle in its place.`
        : `${version} is rolling out to ${currentPercent}% of this lane. Publishing fails unless replaceRollout is true, which reverts that rollout.`,
    );
  }
  if (options.rolloutPercent !== undefined && options.rolloutPercent < 100) {
    warnings.push(
      currentRelease
        ? `About ${options.rolloutPercent}% of devices on OtaKit plugin 3.1 or later receive this release; older plugins receive it when the rollout completes.`
        : 'The first release on a lane goes to every device, so a rollout percentage below 100 is rejected.',
    );
  }
  return warnings;
}
