function normalizeUrl(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().replace(/\/+$/, '');
  return normalized || fallback;
}

const siteUrl = normalizeUrl(process.env.NEXT_PUBLIC_SITE_URL, 'https://www.otakit.app');
const consoleUrl = normalizeUrl(process.env.NEXT_PUBLIC_CONSOLE_URL, 'https://console.otakit.app');

export const site = {
  name: 'OtaKit',
  url: siteUrl,
  tagline: 'Live updates for Capacitor apps',
  description:
    'Ship instant over-the-air updates to your Capacitor apps. No app store delays. Open source and self-hostable.',
  console: consoleUrl,
  signup: `${consoleUrl}/dashboard`,
  github: 'https://github.com/OtaKit/otakit',
  npm: 'https://www.npmjs.com/package/@otakit/cli',
  plugin: 'https://www.npmjs.com/package/@otakit/capacitor-plugin',
  install: 'npm install @otakit/capacitor-plugin',
  supportEmail: process.env.SUPPORT_EMAIL?.trim() || 'support@otakit.app',
  securityEmail: process.env.NEXT_PUBLIC_SECURITY_EMAIL?.trim() || 'security@otakit.app',
} as const;
