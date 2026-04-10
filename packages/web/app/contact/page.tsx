import { headers } from 'next/headers';
import type { Metadata } from 'next';

import { auth } from '@/lib/auth';
import { SUPPORT_EMAIL } from '@/lib/support';

import { ContactPageClient } from './ContactPageClient';

export const metadata: Metadata = {
  title: 'Contact support — OtaKit',
  description: 'Get help with setup, billing, or OTA rollout questions.',
};

export default async function ContactPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const initialEmail = typeof session?.user?.email === 'string' ? session.user.email : '';

  return <ContactPageClient supportEmail={SUPPORT_EMAIL} initialEmail={initialEmail} />;
}
