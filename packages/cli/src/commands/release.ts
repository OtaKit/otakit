import { Command } from 'commander';

import ora from 'ora';

import { ApiClient } from '../lib/api.js';
import { requireConfig } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { normalizeChannel } from '../lib/validate.js';

type ReleaseOptions = {
  appId?: string;
  server?: string;
  channel?: string;
  forceImmediate?: boolean;
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

      if (bundleId) {
        const spinner = ora(`Releasing ${bundleId} to ${targetLabel}...`).start();
        const result = await api.release(channel, bundleId, { forceImmediate });
        if (result.publicationStatus === 'manifest_sync_pending') {
          throw new CliError(
            `Release ${result.release.id} was recorded, but manifest synchronization is pending (operation ${result.operationId}). OtaKit will retry automatically; do not publish it again with a new version.`,
          );
        }
        spinner.succeed(`Released ${bundleId} to ${targetLabel}${forceLabel}.`);
        return;
      }

      // No bundleId — release latest bundle
      const spinner = ora('Finding latest bundle...').start();
      const { bundles } = await api.listBundles({ limit: 1 });
      if (bundles.length === 0) {
        throw new CliError('No bundles found to release.');
      }

      const latest = bundles[0];
      spinner.text = `Releasing ${latest.version} to ${targetLabel}...`;
      const result = await api.release(channel, latest.id, { forceImmediate });
      if (result.publicationStatus === 'manifest_sync_pending') {
        throw new CliError(
          `Release ${result.release.id} was recorded, but manifest synchronization is pending (operation ${result.operationId}). OtaKit will retry automatically; do not publish it again with a new version.`,
        );
      }
      spinner.succeed(`Released ${latest.version} to ${targetLabel}${forceLabel}.`);
    });
  });
