import { Command } from 'commander';

import { ApiClient } from '../lib/api.js';
import { formatBundleDiff } from '../lib/bundle-diff.js';
import { requireConfig } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { normalizeChannel } from '../lib/validate.js';

type DiffOptions = {
  appId?: string;
  server?: string;
  against?: string;
  channel?: string;
  base?: boolean;
  json?: boolean;
};

export const diffCommand = new Command('diff')
  .description(
    'Compare a bundle with another: files added, changed and removed, sizes, the download, and warnings',
  )
  .argument('<bundleId>', 'Bundle to inspect')
  .option('--against <bundleId>', 'Compare with this bundle')
  .option('--channel <channel>', 'Compare with the bundle this channel runs')
  .option('--base', 'Compare with the bundle the base channel runs')
  .option('--json', 'Print machine-readable JSON output')
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .addHelpText(
    'after',
    '\nWithout --against, --channel or --base, the bundle is compared with the previous upload of the same runtime version.',
  )
  .action(async (bundleId: string, options: DiffOptions) => {
    await runCommand(async () => {
      if ([options.against, options.channel, options.base].filter(Boolean).length > 1) {
        throw new CliError('Use only one of --against, --channel and --base.');
      }
      const config = await requireConfig({ appId: options.appId, serverUrl: options.server });
      const diff = await new ApiClient(config).diffBundle(bundleId, {
        against: options.against,
        channel: options.base
          ? null
          : options.channel === undefined
            ? undefined
            : normalizeChannel(options.channel),
      });
      console.log(options.json ? JSON.stringify(diff, null, 2) : formatBundleDiff(diff));
    });
  });
