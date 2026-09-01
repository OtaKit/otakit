import { Command } from 'commander';

import { resolveServerUrl } from '../lib/config.js';
import { runCommand } from '../lib/errors.js';
import {
  fetchAccount,
  initialOrganizationId,
  organizationById,
  organizationDisplayLabel,
  promptForOrganization,
  shellLiteral,
  type AccountResponse,
} from '../lib/organization.js';
import { signInWithEmailOtp } from '../lib/login-flow.js';
import { readStoredAuthProfile, storeAuthProfile } from '../lib/token-store.js';

type LoginOptions = {
  email?: string;
  server?: string;
  tokenOnly?: boolean;
};

export const loginCommand = new Command('login')
  .description('Sign in with email OTP and store access token')
  .option('--email <email>', 'Email address')
  .option('--server <url>', 'Server URL')
  .option('--token-only', 'Print only the token to stdout')
  .action(async (options: LoginOptions) => {
    await runCommand(async () => {
      const serverUrl = resolveServerUrl(process.cwd(), options.server);
      const { token, email: signedInEmail } = await signInWithEmailOtp(serverUrl, options.email);

      const previousProfile = await readStoredAuthProfile(serverUrl);
      let account: AccountResponse;
      try {
        account = await fetchAccount(serverUrl, token);
      } catch (error) {
        if (!options.tokenOnly) throw error;
        const storeResult = await storeAuthProfile(serverUrl, { token });
        process.stdout.write(`${token}\n`);
        if (!storeResult.ok) {
          console.error(
            `Warning: could not store token locally (${storeResult.reason ?? 'unknown reason'}).`,
          );
        }
        return;
      }

      let selectedOrganization =
        account.memberships.length === 1 ? account.memberships[0] : undefined;
      if (
        !selectedOrganization &&
        options.tokenOnly &&
        previousProfile?.userId === account.user.id
      ) {
        selectedOrganization = organizationById(
          account.memberships,
          previousProfile.organizationId,
        );
      }
      if (!selectedOrganization && !options.tokenOnly) {
        selectedOrganization = await promptForOrganization(account.memberships, {
          initialOrganizationId: initialOrganizationId(account, previousProfile),
        });
      }

      const storeResult = await storeAuthProfile(serverUrl, {
        token,
        userId: account.user.id,
        ...(selectedOrganization ? { organizationId: selectedOrganization.organizationId } : {}),
      });

      if (options.tokenOnly) {
        process.stdout.write(`${token}\n`);
        if (!storeResult.ok) {
          console.error(
            `Warning: could not store token locally (${storeResult.reason ?? 'unknown reason'}).`,
          );
        }
        return;
      }

      if (storeResult.ok) {
        const signedInAs = ` as ${account.user.email || signedInEmail}`;
        console.log(`Logged in${signedInAs}.`);
        if (selectedOrganization) {
          console.log(
            `Default organization: ${organizationDisplayLabel(selectedOrganization, account.memberships)}.`,
          );
        }
        console.log(`Token stored locally for ${serverUrl}.`);
        return;
      }

      console.warn(`Could not store token locally: ${storeResult.reason ?? 'unknown reason'}.`);
      console.log('Use env fallback in this shell:');
      console.log(`export OTAKIT_TOKEN=${shellLiteral(token)}`);
      if (selectedOrganization) {
        console.log(
          `export OTAKIT_ORGANIZATION_ID=${shellLiteral(selectedOrganization.organizationId)}`,
        );
      }
    });
  });
