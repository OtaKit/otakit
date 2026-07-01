import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';

import { LoginPageClient } from './LoginPageClient';

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    redirect('/dashboard');
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
    />
  );
}
