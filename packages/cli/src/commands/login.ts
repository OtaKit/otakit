import { Command } from 'commander';

import ora from 'ora';

import { resolveServerUrl } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { fetchCli, parseApiError } from '../lib/http.js';
import {
  fetchAccount,
  initialOrganizationId,
  organizationById,
  organizationDisplayLabel,
  promptForOrganization,
  shellLiteral,
  type AccountResponse,
} from '../lib/organization.js';
import { ask } from '../lib/prompt.js';
import { readStoredAuthProfile, storeAuthProfile } from '../lib/token-store.js';

type LoginOptions = {
  email?: string;
  server?: string;
  tokenOnly?: boolean;
};

type SignInResponse = {
  token?: string;
  user?: {
    email?: string;
  };
};

const OTP_REGEX = /^\d{6}$/;

export const loginCommand = new Command('login')
  .description('Sign in with email OTP and store access token')
  .option('--email <email>', 'Email address')
  .option('--server <url>', 'Server URL')
  .option('--token-only', 'Print only the token to stdout')
  .action(async (options: LoginOptions) => {
    await runCommand(async () => {
      const serverUrl = resolveServerUrl(process.cwd(), options.server);
      const emailInput =
        options.email?.trim().toLowerCase() || (await ask('Email: ')).trim().toLowerCase();

      if (!emailInput) {
        throw new CliError('Email is required.');
      }

      const sendSpinner = ora('Sending verification code...').start();

      const sendOtpResponse = await fetchCli(
        `${serverUrl}/api/auth/email-otp/send-verification-otp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email: emailInput, type: 'sign-in' }),
        },
      );

      if (!sendOtpResponse.ok) {
        sendSpinner.fail('Could not send verification code');
        throw new CliError(await parseApiError(sendOtpResponse));
      }

      sendSpinner.succeed('Verification code sent');

      const otp = (await ask('Verification code: ')).trim();
      if (!OTP_REGEX.test(otp)) {
        throw new CliError('Invalid verification code. Enter the 6-digit code.');
      }

      const verifySpinner = ora('Verifying code...').start();
      const signInResponse = await fetchCli(`${serverUrl}/api/auth/sign-in/email-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: emailInput, otp }),
      });

      if (!signInResponse.ok) {
        verifySpinner.fail('Sign-in failed');
        throw new CliError(await parseApiError(signInResponse));
      }

      const payload = (await signInResponse.json()) as SignInResponse;
      const token = typeof payload.token === 'string' ? payload.token.trim() : '';
      if (!token) {
        verifySpinner.fail('Sign-in failed');
        throw new CliError('Server returned an invalid auth response.');
      }

      verifySpinner.succeed('Signed in');

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
        const signedInAs = ` as ${account.user.email || payload.user?.email || emailInput}`;
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
