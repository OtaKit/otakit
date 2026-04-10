import { Command } from 'commander';

import { ApiClient } from '../lib/api.js';
import { requireConfig } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { normalizeChannel, parsePositiveInteger } from '../lib/validate.js';

type ReleasesOptions = {
  appId?: string;
  server?: string;
  channel?: string;
  base?: boolean;
  limit: string;
};

function formatReleaseTarget(channel: string | null): string {
  return channel ?? 'base channel';
}

export const releasesCommand = new Command('releases')
  .description('Show release history across all streams or a specific target')
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .option('--channel <channel>', 'Channel name')
  .option('--base', 'Show only the base channel')
  .option('--limit <n>', 'Limit results', '10')
  .action(async (options: ReleasesOptions) => {
    await runCommand(async () => {
      if (options.base && options.channel) {
        throw new CliError('Use either --base or --channel, not both.');
      }

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
      const limit = Math.min(parsePositiveInteger(options.limit, 'limit'), 200);

      const response = await api.listReleases(channel, { limit });

      if (response.releases.length === 0) {
        if (channel === undefined) {
          console.log('No releases found.');
        } else {
          console.log(`No releases found for ${formatReleaseTarget(channel)}.`);
        }
        return;
      }

      for (const release of response.releases) {
        const bundleVersion = release.bundleVersion ? ` (${release.bundleVersion})` : '';
        console.log(
          `${formatReleaseTarget(release.channel)}: ${release.bundleId}${bundleVersion} at ${release.promotedAt}`,
        );
      }
      console.log(`Total: ${response.total}`);
    });
  });
