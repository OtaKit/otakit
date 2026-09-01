import ora from 'ora';

import { CliError } from './errors.js';
import { fetchCli, parseApiError } from './http.js';
import { ask } from './prompt.js';

const OTP_REGEX = /^\d{6}$/;

/**
 * Better Auth 1.7 rejects a request that looks browser-originated but carries
 * no Origin, and Node's fetch always sends Sec-Fetch-* headers — so without
 * this the CLI gets MISSING_OR_NULL_ORIGIN on every sign-in. The CLI is a
 * first-party client of the console it was pointed at, so it declares that
 * origin rather than pretending to be something else.
 */
function authHeaders(serverUrl: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: new URL(serverUrl).origin,
  };
}
const MAX_CODE_ATTEMPTS = 3;
// Malformed entries and resends do not burn an attempt, so bound the loop
// itself rather than trusting the user to stop.
const MAX_PROMPTS = 12;

type SignInResponse = {
  token?: string;
  user?: { email?: string };
};

export type SignInResult = {
  token: string;
  email: string;
};

async function sendCode(serverUrl: string, email: string): Promise<void> {
  const spinner = ora('Sending verification code...').start();
  const response = await fetchCli(`${serverUrl}/api/auth/email-otp/send-verification-otp`, {
    method: 'POST',
    headers: authHeaders(serverUrl),
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  if (!response.ok) {
    spinner.fail('Could not send verification code');
    throw new CliError(await parseApiError(response));
  }
  spinner.succeed(`Verification code sent to ${email}`);
}

/**
 * Interactive email-OTP sign-in.
 *
 * A mistyped code used to end the process, forcing a fresh `otakit login` and a
 * newly emailed code. Three attempts and an inline resend cost nothing and stop
 * a typo from being a restart.
 */
export async function signInWithEmailOtp(
  serverUrl: string,
  providedEmail?: string,
): Promise<SignInResult> {
  const email = (providedEmail?.trim() || (await ask('Email: ')).trim()).toLowerCase();
  if (!email) throw new CliError('Email is required.');

  await sendCode(serverUrl, email);

  let attemptsLeft = MAX_CODE_ATTEMPTS;
  let prompts = 0;
  while (attemptsLeft > 0 && prompts < MAX_PROMPTS) {
    prompts += 1;
    const answer = (await ask('Verification code (or "r" to resend): ')).trim();

    if (answer.toLowerCase() === 'r') {
      await sendCode(serverUrl, email);
      continue;
    }
    if (!OTP_REGEX.test(answer)) {
      console.error('Enter the 6-digit code from the email, or "r" to resend.');
      continue;
    }

    const spinner = ora('Verifying code...').start();
    const response = await fetchCli(`${serverUrl}/api/auth/sign-in/email-otp`, {
      method: 'POST',
      headers: authHeaders(serverUrl),
      body: JSON.stringify({ email, otp: answer }),
    });

    if (!response.ok) {
      attemptsLeft -= 1;
      const message = await parseApiError(response);
      spinner.fail(
        attemptsLeft > 0
          ? `${message} (${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left)`
          : message,
      );
      if (attemptsLeft === 0) {
        throw new CliError('Sign-in failed. Run the command again to request a new code.');
      }
      continue;
    }

    const payload = (await response.json()) as SignInResponse;
    const token = typeof payload.token === 'string' ? payload.token.trim() : '';
    if (!token) {
      spinner.fail('Sign-in failed');
      throw new CliError('Server returned an invalid auth response.');
    }
    spinner.succeed('Signed in');
    return { token, email: payload.user?.email || email };
  }

  throw new CliError('Sign-in failed. Run the command again to request a new code.');
}
