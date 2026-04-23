import { Command } from 'commander';

import ora from 'ora';

import { resolveAuthToken, resolveServerUrl } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { fetchCli } from '../lib/http.js';

const APP_SLUG_REGEX = /^[A-Za-z0-9._-]{3,120}$/;

type RegisterOptions = {
  slug: string;
  server?: string;
  token?: string;
};

type RegisterResponse = {
  id: string;
  slug: string;
  createdAt: string;
};

export const registerCommand = new Command('register')
  .description('Create a new app')
  .requiredOption('--slug <slug>', 'App slug (for example: com.example.app)')
  .option('--server <url>', 'Server URL')
  .option('--token <token>', 'Auth token (or set OTAKIT_TOKEN env var)')
  .action(async (options: RegisterOptions) => {
    await runCommand(async () => {
      const slug = options.slug.trim();
      if (!APP_SLUG_REGEX.test(slug)) {
        throw new CliError(
          'Invalid slug. Use 3-120 chars: letters, numbers, dot, underscore, hyphen.',
        );
      }

      const serverUrl = resolveServerUrl(process.cwd(), options.server);
      const explicitToken = options.token?.trim();
      const resolvedAuth = explicitToken
        ? { token: explicitToken }
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

      const spinner = ora(`Creating app "${slug}"...`).start();

      const response = await fetchCli(`${serverUrl}/api/v1/apps`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resolvedAuth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ slug }),
      });

      const contentType = response.headers.get('content-type') ?? '';
      const isJson = contentType.includes('application/json');
      const payload = isJson
        ? ((await response.json()) as { error?: string } & RegisterResponse)
        : null;

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
    });
  });
