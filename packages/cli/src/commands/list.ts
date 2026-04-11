import { Command } from 'commander';

import { ApiClient } from '../lib/api.js';
import { requireConfig } from '../lib/config.js';
import { runCommand } from '../lib/errors.js';
import { parsePositiveInteger } from '../lib/validate.js';

type ListOptions = {
  appId?: string;
  server?: string;
  limit: string;
};

export const listCommand = new Command('list')
  .description('List all bundles')
  .option('--app-id <id>', 'App ID override')
  .option('--server <url>', 'Server URL override')
  .option('--limit <n>', 'Limit results', '20')
  .action(async (options: ListOptions) => {
    await runCommand(async () => {
      const config = await requireConfig({
        appId: options.appId,
        serverUrl: options.server,
      });
      const api = new ApiClient(config);

      const limit = Math.min(parsePositiveInteger(options.limit, 'limit'), 200);

      const response = await api.listBundles({ limit });

      if (response.bundles.length === 0) {
        console.log('No bundles found.');
        return;
      }

      for (const bundle of response.bundles) {
        const runtimeLabel = bundle.runtimeVersion ? `  runtime=${bundle.runtimeVersion}` : '';
        console.log(`${bundle.id}  ${bundle.version}  ${bundle.size} bytes${runtimeLabel}`);
      }
      console.log(`Total: ${response.total}`);
    });
  });
