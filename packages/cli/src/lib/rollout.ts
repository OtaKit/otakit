import { isActiveRollout, OtaKitApiError, type Release } from './api.js';
import { CliError } from './errors.js';

export type RolloutConflict = {
  code: 'ROLLOUT_IN_PROGRESS' | 'ROLLOUT_NEEDS_STABLE';
  message: string;
};

export function laneFlag(channel: string | null): string {
  return channel ? `--channel ${channel}` : '--base';
}

/** " for 10% of devices" for a rollout, empty for a full release. */
export function rolloutSuffix(release: Release): string {
  const percent = release.rolloutPercent ?? 100;
  return percent < 100 ? ` for ${percent}% of devices` : '';
}

/**
 * Why the server would refuse this release because of rollouts, given the
 * lane's current release. Checked before uploading so a refused release does
 * not leave a stray bundle behind.
 */
export function findRolloutConflict(
  current: Release | null | undefined,
  options: { rolloutPercent: number | undefined; replaceRollout: boolean },
): RolloutConflict | null {
  if (current && isActiveRollout(current) && !options.replaceRollout) {
    return {
      code: 'ROLLOUT_IN_PROGRESS',
      message: `Release ${current.bundleVersion ?? current.bundleId} is rolling out to ${current.rolloutPercent}% of this lane`,
    };
  }
  if (!current && options.rolloutPercent !== undefined && options.rolloutPercent < 100) {
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
  const lane = laneFlag(channel);
  return new CliError(
    [
      `${conflict.message.replace(/ of this lane$/, ' on this channel')}.`,
      `Complete it with \`otakit rollout ${lane} --complete\`, cancel it with \`otakit rollout ${lane} --cancel\`,`,
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
