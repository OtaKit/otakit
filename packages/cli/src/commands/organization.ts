import { Command } from 'commander';

import { resolveAuthToken, resolveServerUrl } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import {
  fetchAccount,
  initialOrganizationId,
  organizationDisplayLabel,
  promptForOrganization,
  shellLiteral,
} from '../lib/organization.js';
import { readStoredAuthProfile, storeSelectedOrganization } from '../lib/token-store.js';

type SelectOptions = {
  server?: string;
};

const selectCommand = new Command('select')
  .description('Choose the default organization for commands not tied to an app')
  .option('--server <url>', 'OtaKit console URL')
  .action(async (options: SelectOptions) => {
    await runCommand(async () => {
      const serverUrl = resolveServerUrl(process.cwd(), options.server);
      const auth = await resolveAuthToken(serverUrl);
      if (!auth) {
        throw new CliError('Not authenticated. Run `otakit login`, or set OTAKIT_TOKEN.');
      }
      if (auth.token.startsWith('otakit_sk_')) {
        throw new CliError(
          'Organization API keys are already bound to one organization; no selection is needed.',
        );
      }

      const account = await fetchAccount(serverUrl, auth.token);
      const storedProfile = auth.source === 'file' ? await readStoredAuthProfile(serverUrl) : null;
      const selected = await promptForOrganization(account.memberships, {
        initialOrganizationId: initialOrganizationId(account, storedProfile),
      });

      if (auth.source !== 'file') {
        console.log('');
        console.log(
          `Selected organization: ${organizationDisplayLabel(selected, account.memberships)}.`,
        );
        console.log('OTAKIT_TOKEN is active, so use this organization in the same environment:');
        console.log(`export OTAKIT_ORGANIZATION_ID=${shellLiteral(selected.organizationId)}`);
        return;
      }

      const stored = await storeSelectedOrganization(
        serverUrl,
        account.user.id,
        selected.organizationId,
      );
      if (!stored.ok) {
        throw new CliError(stored.reason ?? 'Could not store the selected organization.');
      }

      console.log('');
      console.log(
        `Default organization: ${organizationDisplayLabel(selected, account.memberships)}.`,
      );
      console.log('Restart running MCP connections to use the new default.');
    });
  });

export const organizationCommand = new Command('organization')
  .alias('org')
  .description('Manage the CLI organization context')
  .addCommand(selectCommand);
