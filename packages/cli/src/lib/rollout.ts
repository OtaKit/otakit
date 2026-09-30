import { isActiveRollout, OtaKitApiError, type Release } from './api.js';
import type { LaneState } from './compat-check.js';
import { CliError } from './errors.js';

export type RolloutConflict = {
  code: 'ROLLOUT_IN_PROGRESS' | 'ROLLOUT_NEEDS_STABLE';
  message: string;
  /** The rolling release, when known. */
  releaseId?: string;
};

function laneFlag(channel: string | null): string {
  return channel ? `--channel ${channel}` : '--base';
}

/** " for 10% of devices" for a rollout, empty for a full release. */
export function rolloutSuffix(release: Release): string {
  const percent = release.rolloutPercent ?? 100;
  return percent < 100 ? ` for ${percent}% of devices` : '';
}

/**
 * Why the server would refuse this release because of rollouts. Checked
 * before uploading so a refused release does not leave a stray bundle
 * behind; when the lane is not fully known, the server decides.
 */
export function findRolloutConflict(
  lane: Pick<LaneState, 'current' | 'complete'>,
  options: { rolloutPercent: number | undefined; replaceRollout: boolean },
): RolloutConflict | null {
  const { current } = lane;
  if (current && isActiveRollout(current) && !options.replaceRollout) {
    return {
      code: 'ROLLOUT_IN_PROGRESS',
      message: `Release ${current.bundleVersion ?? current.bundleId} is rolling out to ${current.rolloutPercent}% of this lane`,
      releaseId: current.id,
    };
  }
  if (
    !current &&
    lane.complete &&
    options.rolloutPercent !== undefined &&
    options.rolloutPercent < 100
  ) {
    return {
      code: 'ROLLOUT_NEEDS_STABLE',
      message: 'The first release on a lane goes to every device',
    };
  }
  return null;
}

/** A rollout refusal, explained with the CLI commands that resolve it. */
export function rolloutConflictError(conflict: RolloutConflict, channel: string | null): CliError {
  if (conflict.code === 'ROLLOUT_NEEDS_STABLE') {
    return new CliError(
      'The first release on a channel goes to every device. Release without --rollout; later releases can roll out gradually.',
    );
  }
  // The release ID names the rollout exactly, even when several runtime
  // lanes of the channel are rolling out.
  const target = conflict.releaseId ?? laneFlag(channel);
  return new CliError(
    [
      `${conflict.message.replace(/ of this lane$/, ' on this channel')}.`,
      `Complete it with \`otakit rollout ${target} --complete\`, cancel it with \`otakit rollout ${target} --cancel\`,`,
      'or pass --replace-rollout to cancel it and release this bundle instead.',
    ].join('\n'),
  );
}

/** Explain a publish the server refused because of rollouts; other errors pass through. */
export function explainRolloutConflict(error: unknown, channel: string | null): unknown {
  if (
    error instanceof OtaKitApiError &&
    (error.code === 'ROLLOUT_IN_PROGRESS' || error.code === 'ROLLOUT_NEEDS_STABLE')
  ) {
    return rolloutConflictError({ code: error.code, message: error.message }, channel);
  }
  return error;
}
