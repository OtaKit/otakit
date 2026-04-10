import { Command } from 'commander';

import ora from 'ora';

import { resolveServerUrl } from '../lib/config.js';
import { CliError, runCommand } from '../lib/errors.js';
import { fetchCli, parseApiError } from '../lib/http.js';
import { ask } from '../lib/prompt.js';
import { storeAccessToken } from '../lib/token-store.js';

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

function toShellLiteral(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

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

      const storeResult = await storeAccessToken(serverUrl, token);
      verifySpinner.succeed('Signed in');

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
        const signedInAs =
          typeof payload.user?.email === 'string' ? ` as ${payload.user.email}` : '';
        console.log(`Logged in${signedInAs}.`);
        console.log(`Token stored locally for ${serverUrl}.`);
        return;
      }

      console.warn(`Could not store token locally: ${storeResult.reason ?? 'unknown reason'}.`);
      console.log('Use env fallback in this shell:');
      console.log(`export OTAKIT_TOKEN=${toShellLiteral(token)}`);
    });
  });
