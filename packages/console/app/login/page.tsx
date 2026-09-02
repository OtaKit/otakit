import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';

import { LoginPageClient } from './LoginPageClient';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * `/oauth/consent` and `/oauth/select-organization` bounce signed-out users here
 * with the original authorization query intact. Rebuild the destination from it
 * so every sign-in path returns to the pending authorization instead of dropping
 * it on the dashboard. The path is a literal; only the query is carried over, so
 * this can never redirect off-origin.
 */
function pendingAuthorizationPath(
  query: Record<string, string | string[] | undefined>,
): string | null {
  if (typeof query.client_id !== 'string' || query.client_id.length === 0) return null;
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === 'string') params.set(name, value);
    else value?.forEach((item) => params.append(name, item));
  }
  const serialized = params.toString();
  return serialized ? `/oauth/consent?${serialized}` : '/oauth/consent';
}

/**
 * What a failed sign-in comes back as. Better Auth reports its own codes here,
 * and the providers add theirs, so anything unrecognised is still shown rather
 * than swallowed: an unexplained code beats a blank page.
 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  state_mismatch:
    'That sign-in attempt expired before it came back. Start it again and finish within a few minutes.',
  please_restart_the_process:
    'That sign-in attempt expired before it came back. Start it again and finish within a few minutes.',
  access_denied: 'The provider cancelled that sign-in. Try again, or use an email code.',
  account_not_linked:
    'An account with this email already exists with a different sign-in method. Use that one, or an email code.',
  invalid_origin: 'This console rejected the sign-in origin. Check BETTER_AUTH_URL on the server.',
  internal_server_error: 'The server could not finish that sign-in. Try again in a moment.',
};

function describeAuthError(query: Record<string, string | string[] | undefined>): string | null {
  const code = typeof query.error === 'string' ? query.error : null;
  if (!code) return null;
  const description = typeof query.error_description === 'string' ? query.error_description : null;
  return AUTH_ERROR_MESSAGES[code] ?? description ?? `Sign-in failed (${code}). Please try again.`;
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const authorizationPath = pendingAuthorizationPath(query);
  const initialError = describeAuthError(query);
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    redirect(authorizationPath ?? '/dashboard');
  }

  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const appleEnabled = Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET);
  const githubEnabled = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://otakit.app').replace(/\/+$/, '');

  return (
    <LoginPageClient
      googleEnabled={googleEnabled}
      appleEnabled={appleEnabled}
      githubEnabled={githubEnabled}
      siteUrl={siteUrl}
      authorizationPath={authorizationPath}
      initialError={initialError}
    />
  );
}
