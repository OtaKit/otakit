import { Command } from 'commander';

import { resolveServerUrl } from '../lib/config.js';
import { runCommand } from '../lib/errors.js';
import { clearStoredAccessToken } from '../lib/token-store.js';

type LogoutOptions = {
  server?: string;
};

export const logoutCommand = new Command('logout')
  .description('Remove stored access token')
  .option('--server <url>', 'Server URL')
  .action(async (options: LogoutOptions) => {
    await runCommand(async () => {
      const serverUrl = resolveServerUrl(process.cwd(), options.server);
      const result = await clearStoredAccessToken(serverUrl);

      if (!result.ok) {
        console.warn(`Could not update local token store: ${result.reason ?? 'unknown reason'}.`);
      } else if (result.deleted) {
        console.log(`Removed stored token for ${serverUrl}.`);
      } else {
        console.log(`No stored token found for ${serverUrl}.`);
      }

      console.log('If needed for this shell session, also run:');
      console.log('unset OTAKIT_TOKEN');
    });
  });
