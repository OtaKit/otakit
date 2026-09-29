import { Command } from 'commander';

import ora from 'ora';

import { ApiClient, isActiveRollout, type Release } from '../lib/api.js';
import { requireConfig } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { laneFlag } from '../lib/rollout.js';
import { normalizeChannel, parseRolloutPercent } from '../lib/validate.js';

type RolloutOptions = {
  appId?: string;
  server?: string;
  channel?: string;
  base?: boolean;
  percent?: string;
  complete?: boolean;
  cancel?: boolean;
};

function laneLabel(release: Release): string {
  const target = release.channel ?? 'base channel';
  return release.runtimeVersion ? `${target} (runtime ${release.runtimeVersion})` : target;
}

function describeRollout(release: Release): string {
  return `${laneLabel(release)}: ${release.bundleVersion ?? release.bundleId} at ${release.rolloutPercent}% (release ${release.id})`;
}

/**
 * The active rollout to act on: the only one on the selected channel. Several
 * runtime lanes can roll out on one channel at once, so an ambiguous choice
 * asks for the release ID instead of guessing.
 */
function selectRollout(rollouts: Release[], channel: string | null | undefined): Release {
  const candidates =
    channel === undefined
      ? rollouts
      : rollouts.filter((candidate) => candidate.channel === channel);
  if (candidates.length === 1) {
    return candidates[0];
  }
  if (candidates.length === 0) {
    throw new CliError(
      channel === undefined
        ? 'No release is rolling out.'
        : `No release is rolling out on ${channel ?? 'the base channel'}.`,
    );
  }
  throw new CliError(
    [
      'Several releases are rolling out; pass the release ID:',
      ...candidates.map(describeRollout),
    ].join('\n'),
  );
}

export const rolloutCommand = new Command('rollout')
  .description(
    'Show active rollouts, or raise, lower, complete, or cancel one (see `otakit release --rollout`)',
  )
  .argument('[releaseId]', 'Rolling release ID (default: the active rollout on the channel)')
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .option('--channel <channel>', 'Channel of the rollout')
  .option('--base', 'The rollout on the base channel')
  .option('--percent <percent>', 'Set the share of devices (1-100; 100 completes the rollout)')
  .option('--complete', 'Release to every device')
  .option('--cancel', 'Revert the rolling release; every device returns to the previous release')
  .action(async (releaseId: string | undefined, options: RolloutOptions) => {
    await runCommand(async () => {
      if (options.base && options.channel) {
        throw new CliError('Use either --base or --channel, not both.');
      }
      const actions = [options.percent !== undefined, options.complete, options.cancel].filter(
        Boolean,
      );
      if (actions.length > 1) {
        throw new CliError('Use only one of --percent, --complete, or --cancel.');
      }
      const percent = options.complete
        ? 100
        : options.percent === undefined
          ? undefined
          : parseRolloutPercent(options.percent, '--percent');

      const config = await requireConfig({
        appId: options.appId,
        serverUrl: options.server,
      });
      const api = new ApiClient(config);
      const channel = options.base
        ? null
        : options.channel
          ? normalizeChannel(options.channel)
          : undefined;

      // An explicit release ID goes straight to the server, which checks that
      // it is an active rollout. Otherwise, find it among recent releases: an
      // active rollout is always the newest release of its lane.
      let rollout: Release | undefined;
      if (!releaseId) {
        const { releases } = await api.listReleases(channel, { limit: 200 });
        const rollouts = releases.filter(isActiveRollout);
        if (percent === undefined && !options.cancel) {
          if (rollouts.length === 0) {
            console.log('No release is rolling out.');
          }
          for (const release of rollouts) console.log(describeRollout(release));
          return;
        }
        rollout = selectRollout(rollouts, channel);
      } else if (percent === undefined && !options.cancel) {
        throw new CliError('Pass --percent, --complete, or --cancel to change a rollout.');
      }
      const targetId = rollout?.id ?? (releaseId as string);

      if (options.cancel) {
        const spinner = ora('Cancelling the rollout...').start();
        const result = await api.revertRelease(targetId, { expectedCurrentReleaseId: targetId });
        if (result.publicationStatus === 'manifest_sync_pending') {
          throw new CliError(
            `The rollout was cancelled, but manifest synchronization is pending (operation ${result.operationId}). OtaKit will retry automatically.`,
          );
        }
        spinner.succeed(
          `Cancelled the rollout of ${result.release.bundleVersion} on ${laneLabel(result.release)}; every device returns to ${result.currentRelease?.bundleVersion ?? 'the built-in bundle'}.`,
        );
        return;
      }

      const spinner = ora(`Changing the rollout to ${percent}%...`).start();
      const result = await api.updateRollout(targetId, {
        percent: percent ?? 100,
        expectedPercent: rollout?.rolloutPercent,
      });
      if (result.publicationStatus === 'manifest_sync_pending') {
        throw new CliError(
          `The rollout change was recorded, but manifest synchronization is pending (operation ${result.operationId}). OtaKit will retry automatically.`,
        );
      }
      const lane = laneLabel(result.release);
      if (result.release.rolloutPercent === 100) {
        spinner.succeed(
          `Completed the rollout of ${result.release.bundleVersion} on ${lane}; every device now receives it.`,
        );
        return;
      }
      spinner.succeed(
        `Rollout of ${result.release.bundleVersion} on ${lane}: ${result.previousPercent}% → ${result.release.rolloutPercent}%.`,
      );
      console.log(
        `Complete it with \`otakit rollout ${laneFlag(result.release.channel)} --complete\`.`,
      );
    });
  });
