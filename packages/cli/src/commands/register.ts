import { Command } from 'commander';

import ora from 'ora';

import {
  resolveAuthToken,
  resolveOrganizationOverride,
  resolveServerUrl,
  type ResolvedAuthToken,
} from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { fetchCli } from '../lib/http.js';
import {
  fetchAccount,
  initialOrganizationId,
  organizationById,
  promptForOrganization,
  shellLiteral,
  type AccountResponse,
} from '../lib/organization.js';
import { readStoredAuthProfile, storeSelectedOrganization } from '../lib/token-store.js';

const APP_SLUG_REGEX = /^[A-Za-z0-9._-]{3,120}$/;

type RegisterOptions = {
  slug: string;
  server?: string;
  token?: string;
  secretKey?: string;
};

type RegisterResponse = {
  id: string;
  slug: string;
  createdAt: string;
};

type RegisterPayload = { error?: string; code?: string } & Partial<RegisterResponse>;

async function createApp(
  serverUrl: string,
  token: string,
  slug: string,
  organizationId?: string,
): Promise<{ response: Response; payload: RegisterPayload | null }> {
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });
  if (organizationId) headers.set('X-OtaKit-Organization-Id', organizationId);
  const response = await fetchCli(`${serverUrl}/api/v1/apps`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ slug }),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? ((await response.json()) as RegisterPayload)
    : null;
  return { response, payload };
}

export const registerCommand = new Command('register')
  .description('Create a new app')
  .requiredOption('--slug <slug>', 'App slug (for example: com.example.app)')
  .option('--server <url>', 'Server URL')
  .option('--token <token>', 'Auth token (or set OTAKIT_TOKEN env var)')
  .option('--secret-key <key>', 'Alias for --token')
  .action(async (options: RegisterOptions) => {
    await runCommand(async () => {
      const slug = options.slug.trim();
      if (!APP_SLUG_REGEX.test(slug)) {
        throw new CliError(
          'Invalid slug. Use 3-120 chars: letters, numbers, dot, underscore, hyphen.',
        );
      }

      const serverUrl = resolveServerUrl(process.cwd(), options.server);
      if (options.token && options.secretKey) {
        throw new CliError('Use either `--token` or `--secret-key`, not both.');
      }
      const explicitToken = options.token?.trim() || options.secretKey?.trim();
      const resolvedAuth: ResolvedAuthToken | null = explicitToken
        ? { token: explicitToken, source: 'env_token' }
        : await resolveAuthToken(serverUrl);

      if (!resolvedAuth?.token) {
        throw new CliError(
          [
            'Authentication required. Use one of:',
            '  1. otakit login',
            '  2. --token <token>',
            '  3. OTAKIT_TOKEN env var',
          ].join('\n'),
        );
      }

      const organizationOverride = resolveOrganizationOverride();
      let organizationId = organizationOverride ?? resolvedAuth.organizationId;
      let account: AccountResponse | undefined;

      if (!organizationOverride && resolvedAuth.source === 'file') {
        account = await fetchAccount(serverUrl, resolvedAuth.token);
        const current = organizationById(account.memberships, organizationId);
        if (!current) {
          const storedProfile = await readStoredAuthProfile(serverUrl);
          const selected = await promptForOrganization(account.memberships, {
            initialOrganizationId: initialOrganizationId(account, storedProfile),
          });
          organizationId = selected.organizationId;
          const stored = await storeSelectedOrganization(
            serverUrl,
            account.user.id,
            selected.organizationId,
          );
          if (!stored.ok) {
            throw new CliError(stored.reason ?? 'Could not store the selected organization.');
          }
        }
      }

      const spinner = ora(`Creating app "${slug}"...`).start();
      let { response, payload } = await createApp(
        serverUrl,
        resolvedAuth.token,
        slug,
        organizationId,
      );

      if (
        response.status === 409 &&
        payload?.code === 'ORGANIZATION_SELECTION_REQUIRED' &&
        !organizationId
      ) {
        spinner.stop();
        account ??= await fetchAccount(serverUrl, resolvedAuth.token);
        const selected = await promptForOrganization(account.memberships, {
          initialOrganizationId: initialOrganizationId(account),
        });
        organizationId = selected.organizationId;
        if (resolvedAuth.source === 'file') {
          const stored = await storeSelectedOrganization(
            serverUrl,
            account.user.id,
            selected.organizationId,
          );
          if (!stored.ok) {
            throw new CliError(stored.reason ?? 'Could not store the selected organization.');
          }
        }
        spinner.start();
        ({ response, payload } = await createApp(
          serverUrl,
          resolvedAuth.token,
          slug,
          organizationId,
        ));
      }

      if (!response.ok) {
        spinner.fail('Failed to create app');
        const errorMessage =
          typeof payload?.error === 'string' ? payload.error : `API error (${response.status})`;
        throw new CliError(errorMessage);
      }

      if (!payload?.id || !payload.slug) {
        spinner.fail('Failed to create app');
        throw new CliError('Server returned an invalid response.');
      }

      spinner.succeed('App created');

      console.log(`App ID:      ${payload.id}`);
      console.log(`App Slug:    ${payload.slug}`);
      console.log('');
      console.log('Add this to capacitor.config.ts:');
      console.log('');
      console.log('plugins: {');
      console.log('  OtaKit: {');
      console.log(`    appId: "${payload.id}",`);
      console.log('    appReadyTimeout: 10000,');
      console.log('    // Optional:');
      console.log('    // channel: "staging",');
      console.log('    // runtimeVersion: "2026.04",');
      console.log('    // launchPolicy: "apply-staged",');
      console.log('    // resumePolicy: "shadow",');
      console.log('    // runtimePolicy: "immediate",');
      console.log('  },');
      console.log('}');
      console.log('');
      console.log('Next steps:');
      console.log('1. Build your web app');
      console.log('2. Run `otakit upload --release`');
      if (
        organizationId &&
        resolvedAuth.source !== 'file' &&
        !resolvedAuth.token.startsWith('otakit_sk_')
      ) {
        console.log('');
        console.log('For later app-less commands in this environment:');
        console.log(`export OTAKIT_ORGANIZATION_ID=${shellLiteral(organizationId)}`);
      }
    });
  });
