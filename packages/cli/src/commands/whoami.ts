import { Command } from 'commander';

import { ApiClient } from '../lib/api.js';
import { resolveAuthToken, resolveOrganizationOverride, resolveServerUrl } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { fetchAccount, organizationById, organizationDisplayLabel } from '../lib/organization.js';
import { CLI_VERSION } from '../lib/version.js';

type WhoamiOptions = {
  server?: string;
  json?: boolean;
};

type KeyContext = {
  organization: { id: string; name: string };
  actor: { type: string; id: string; role?: string };
};

export const whoamiCommand = new Command('whoami')
  .description('Show current authenticated user and organization context')
  .option('--server <url>', 'Server URL')
  .option('--json', 'Print machine-readable account details')
  .action(async (options: WhoamiOptions) => {
    await runCommand(async () => {
      const serverUrl = resolveServerUrl(process.cwd(), options.server);
      const auth = await resolveAuthToken(serverUrl);

      if (!auth) {
        throw new CliError(
          ['Not authenticated.', 'Run `otakit login`, or set OTAKIT_TOKEN.'].join('\n'),
        );
      }

      if (auth.token.startsWith('otakit_sk_')) {
        const client = new ApiClient(
          {
            appId: '00000000-0000-0000-0000-000000000000',
            serverUrl,
            authToken: auth.token,
            authSource: auth.source,
          },
          CLI_VERSION,
        );
        const context = await client.request<KeyContext>('/api/v1/context');
        if (options.json) {
          console.log(
            JSON.stringify(
              { credential: 'organization_key', organization: context.organization },
              null,
              2,
            ),
          );
          return;
        }
        console.log('Credential: organization API key');
        console.log(`Organization: ${context.organization.name}`);
        return;
      }

      const account = await fetchAccount(serverUrl, auth.token);
      const overrideOrganizationId = resolveOrganizationOverride();
      const effectiveOrganizationId = overrideOrganizationId ?? auth.organizationId;
      const effectiveOrganization = organizationById(account.memberships, effectiveOrganizationId);

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              ...account,
              cli: {
                authSource: auth.source,
                organizationId: effectiveOrganizationId ?? null,
                organizationSource: overrideOrganizationId
                  ? 'environment'
                  : auth.organizationId
                    ? 'stored_profile'
                    : 'none',
              },
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(`User: ${account.user.email}`);
      console.log(`Auth source: ${auth.source}`);
      if (effectiveOrganization) {
        const prefix = overrideOrganizationId ? 'Environment organization' : 'Default organization';
        console.log(
          `${prefix}: ${organizationDisplayLabel(effectiveOrganization, account.memberships)}`,
        );
      } else if (effectiveOrganizationId) {
        console.log('Organization selection: unavailable or no longer accessible');
        console.log('Run `otakit organization select` to choose a current membership.');
      } else {
        console.log('Default organization: not selected');
        if (account.memberships.length > 1) {
          console.log('Run `otakit organization select` to choose one.');
        }
      }

      console.log('');
      if (account.memberships.length === 0) {
        console.log('Memberships: none');
        return;
      }

      console.log('Memberships:');
      for (const membership of account.memberships) {
        const marker = membership.organizationId === effectiveOrganizationId ? '*' : '-';
        console.log(`  ${marker} ${organizationDisplayLabel(membership, account.memberships)}`);
      }
    });
  });
