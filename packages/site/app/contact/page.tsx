import type { Metadata } from 'next';

import { SUPPORT_EMAIL } from '@/lib/support';

import { ContactPageClient } from './ContactPageClient';

export const metadata: Metadata = {
  title: 'Contact support — OtaKit',
  description: 'Get help with setup, billing, or OTA rollout questions.',
};

export default function ContactPage() {
  return <ContactPageClient supportEmail={SUPPORT_EMAIL} initialEmail="" />;
}
