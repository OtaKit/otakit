'use client';

import { Analytics } from '@vercel/analytics/next';
import { usePathname } from 'next/navigation';

import { GoogleTag } from '@/app/components/GoogleTag';

/**
 * Page analytics for the console. Preview pages (`/p/<token>`) carry a secret
 * token in their URL, so they load no analytics at all.
 */
export function ConsoleAnalytics() {
  const pathname = usePathname();
  if (pathname?.startsWith('/p/')) return null;
  return (
    <>
      <Analytics />
      <GoogleTag />
    </>
  );
}
