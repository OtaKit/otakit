import ora from 'ora';

import { CliError } from './errors.js';
import { fetchCli, parseApiError } from './http.js';
import { ask } from './prompt.js';

const OTP_REGEX = /^\d{6}$/;
const MAX_CODE_ATTEMPTS = 3;

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
    headers: { 'Content-Type': 'application/json' },
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
  while (attemptsLeft > 0) {
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
      headers: { 'Content-Type': 'application/json' },
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
