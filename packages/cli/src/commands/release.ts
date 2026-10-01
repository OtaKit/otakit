import { Command } from 'commander';

import ora from 'ora';

import { ApiClient } from '../lib/api.js';
import { requireConfig } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { readReleaseNotes } from '../lib/notes.js';
import { explainRolloutConflict, rolloutSuffix } from '../lib/rollout.js';
import { normalizeChannel, parseRolloutPercent } from '../lib/validate.js';

type ReleaseOptions = {
  appId?: string;
  server?: string;
  channel?: string;
  forceImmediate?: boolean;
  rollout?: string;
  replaceRollout?: boolean;
  notes?: string;
  notesFile?: string;
};

export const releaseCommand = new Command('release')
  .description('Release a bundle to the base channel or a named channel')
  .argument('[bundleId]', 'Bundle ID to release')
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .option('--channel <channel>', 'Channel name (omit for the base channel)')
  .option(
    '--force-immediate',
    'Devices apply and reload this release on their next check (emergency fixes)',
  )
  .option(
    '--rollout <percent>',
    'Release to this share of devices first (1-100, default 100); needs a previous release on the channel',
  )
  .option(
    '--replace-rollout',
    "Cancel the channel's active rollout and release this bundle in its place",
  )
  .option('--notes <text>', 'Release notes app users may see (plain text, up to 2,000 characters)')
  .option('--notes-file <path>', 'Read the release notes from a file')
  .action(async (bundleId: string | undefined, options: ReleaseOptions) => {
    await runCommand(async () => {
      const config = await requireConfig({
        appId: options.appId,
        serverUrl: options.server,
      });
      const api = new ApiClient(config);
      const channel = options.channel ? normalizeChannel(options.channel) : null;
      const targetLabel = channel ?? 'base channel';
      const forceImmediate = options.forceImmediate === true;
      const forceLabel = forceImmediate ? ' (force immediate)' : '';
      const notes = await readReleaseNotes(options);
      const notesLabel = notes ? ' with release notes' : '';
      const releaseOptions = {
        forceImmediate,
        rolloutPercent:
          options.rollout === undefined
            ? undefined
            : parseRolloutPercent(options.rollout, '--rollout'),
        replaceRollout: options.replaceRollout === true ? true : undefined,
        notes,
      };
      const release = async (id: string) => {
        try {
          return await api.release(channel, id, releaseOptions);
        } catch (error) {
          throw explainRolloutConflict(error, channel);
        }
      };

      if (bundleId) {
        const spinner = ora(`Releasing ${bundleId} to ${targetLabel}...`).start();
        const result = await release(bundleId).catch((error: unknown) => {
          spinner.fail('Release failed.');
          throw error;
        });
        if (result.publicationStatus === 'manifest_sync_pending') {
          throw new CliError(
            `Release ${result.release.id} was recorded, but manifest synchronization is pending (operation ${result.operationId}). OtaKit will retry automatically; do not publish it again with a new version.`,
          );
        }
        spinner.succeed(
          `Released ${bundleId} to ${targetLabel}${rolloutSuffix(result.release)}${forceLabel}${notesLabel}.`,
        );
        return;
      }

      // No bundleId — release latest bundle
      const spinner = ora('Finding latest bundle...').start();
      const result = await (async () => {
        const { bundles } = await api.listBundles({ limit: 1 });
        if (bundles.length === 0) {
          throw new CliError('No bundles found to release.');
        }
        spinner.text = `Releasing ${bundles[0].version} to ${targetLabel}...`;
        return { latest: bundles[0], ...(await release(bundles[0].id)) };
      })().catch((error: unknown) => {
        spinner.fail('Release failed.');
        throw error;
      });
      const latest = result.latest;
      if (result.publicationStatus === 'manifest_sync_pending') {
        throw new CliError(
          `Release ${result.release.id} was recorded, but manifest synchronization is pending (operation ${result.operationId}). OtaKit will retry automatically; do not publish it again with a new version.`,
        );
      }
      spinner.succeed(
        `Released ${latest.version} to ${targetLabel}${rolloutSuffix(result.release)}${forceLabel}${notesLabel}.`,
      );
    });
  });
