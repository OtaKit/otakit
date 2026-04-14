import { Command } from 'commander';

import { resolveAuthToken, resolveServerUrl } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { fetchCli, parseApiError } from '../lib/http.js';

type WhoamiOptions = {
  server?: string;
};

type WhoamiResponse = {
  user: {
    id: string;
    email: string;
    name: string;
    activeOrganizationId: string | null;
  };
  memberships: Array<{
    id: string;
    organizationId: string;
    organizationName: string;
    role: string;
  }>;
};

export const whoamiCommand = new Command('whoami')
  .description('Show current authenticated user and organization context')
  .option('--server <url>', 'Server URL')
  .action(async (options: WhoamiOptions) => {
    await runCommand(async () => {
      const serverUrl = resolveServerUrl(process.cwd(), options.server);
      const auth = await resolveAuthToken(serverUrl);

      if (!auth) {
        throw new CliError(
          [
            'Not authenticated.',
            'Run `otakit login`, or set OTAKIT_TOKEN.',
          ].join('\n'),
        );
      }

      const response = await fetchCli(`${serverUrl}/api/v1/me`, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
        },
      });

      if (!response.ok) {
        throw new CliError(await parseApiError(response));
      }

      const payload = (await response.json()) as WhoamiResponse;
      console.log(`User: ${payload.user.email}`);
      console.log(`User ID: ${payload.user.id}`);
      console.log(`Active organization: ${payload.user.activeOrganizationId ?? '(none)'}`);
      console.log(`Auth source: ${auth.source}`);
      console.log('');

      if (payload.memberships.length === 0) {
        console.log('Memberships: none');
        return;
      }

      console.log('Memberships:');
      for (const membership of payload.memberships) {
        console.log(
          `- ${membership.organizationName} (${membership.organizationId}) [${membership.role}]`,
        );
      }
    });
  });
