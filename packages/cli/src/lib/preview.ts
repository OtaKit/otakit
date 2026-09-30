import QRCode from 'qrcode';

import { CliError } from './errors.js';
import type { Preview, PreviewExpiry } from './api.js';

const EXPIRY_OPTIONS: readonly PreviewExpiry[] = ['1h', '24h', '7d', '30d'];

export function parsePreviewExpiry(value: string | undefined): PreviewExpiry | undefined {
  if (value === undefined) return undefined;
  const expiry = value.trim().toLowerCase();
  if (!(EXPIRY_OPTIONS as readonly string[]).includes(expiry)) {
    throw new CliError(`--expires must be one of ${EXPIRY_OPTIONS.join(', ')} (got "${value}").`);
  }
  return expiry as PreviewExpiry;
}

/** The link, how long it works, a terminal QR code, and what the app needs to open it. */
export async function renderPreview(preview: Preview): Promise<string> {
  const qr = await QRCode.toString(preview.url, { type: 'terminal', small: true });
  return [
    `Preview of ${preview.bundleVersion} (expires ${preview.expiresAt}):`,
    preview.url,
    '',
    qr.trimEnd(),
    '',
    preview.deepLink
      ? 'Scan it with the phone camera, then tap "Open in the app". The app needs OtaKit plugin 3.2+ with previewLinks: true.'
      : `The app's URL scheme is not set yet, so the link cannot open the app. Set it once with \`otakit preview ${preview.bundleId} --scheme <scheme>\` (for example myapp).`,
    `Revoke it with \`otakit preview --revoke ${preview.id}\`.`,
  ].join('\n');
}
