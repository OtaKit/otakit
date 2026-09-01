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

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const authorizationPath = pendingAuthorizationPath(query);
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
    />
  );
}
