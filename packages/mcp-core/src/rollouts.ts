type LaneRelease = { bundleVersion?: string; rolloutPercent?: number } | null | undefined;

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
