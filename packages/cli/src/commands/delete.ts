import { Command } from 'commander';

import { ApiClient } from '../lib/api.js';
import { requireConfig } from '../lib/config.js';
import { runCommand } from '../lib/errors.js';
import { confirm } from '../lib/prompt.js';

type DeleteOptions = {
  appId?: string;
  server?: string;
  force?: boolean;
};

export const deleteCommand = new Command('delete')
  .description('Delete a bundle')
  .argument('<bundleId>', 'Bundle ID to delete')
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .option('--force', 'Skip confirmation')
  .action(async (bundleId: string, options: DeleteOptions) => {
    await runCommand(async () => {
      const config = await requireConfig({
        appId: options.appId,
        serverUrl: options.server,
      });
      const api = new ApiClient(config);

      if (!options.force) {
        const accepted = await confirm(`Delete bundle ${bundleId}?`);
        if (!accepted) {
          console.log('Cancelled.');
          return;
        }
      }

      await api.deleteBundle(bundleId);
      console.log(`Deleted bundle ${bundleId}.`);
    });
  });
