import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { Toaster } from '@/components/ui/sonner';
import { site } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: 'OtaKit — Live updates for Capacitor apps',
    template: '%s — OtaKit',
  },
  description: site.description,
  keywords: [
    'Capacitor',
    'OTA updates',
    'over-the-air updates',
    'live updates',
    'CodePush',
    'mobile app updates',
    'Ionic',
    'self-hosted',
  ],
  openGraph: {
    title: 'OtaKit — Live updates for Capacitor apps',
    description: site.description,
    url: site.url,
    siteName: site.name,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OtaKit — Live updates for Capacitor apps',
    description: site.description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Analytics />
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
