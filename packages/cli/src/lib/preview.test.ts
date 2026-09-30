import { describe, expect, it } from 'vitest';

import type { Preview } from './api.js';
import { parsePreviewExpiry, renderPreview } from './preview.js';

const preview: Preview = {
  id: '0ee77672-f7de-4291-bcd2-fac9bda4b92b',
  bundleId: 'f32627ca-9e8c-4358-90d8-bde732400081',
  bundleVersion: '1.4.0',
  runtimeVersion: null,
  createdAt: '2026-09-30T10:00:00.000Z',
  createdBy: 'dev@example.com',
  expiresAt: '2026-10-07T10:00:00.000Z',
  url: 'https://console.otakit.app/p/abcdefghijklmnopqrstuvwxyz',
  qrUrl: 'https://console.otakit.app/p/abcdefghijklmnopqrstuvwxyz/qr.png',
  deepLink: 'myapp://otakit-preview?token=abcdefghijklmnopqrstuvwxyz',
};

describe('preview output', () => {
  it('accepts the supported link lifetimes', () => {
    expect(parsePreviewExpiry(undefined)).toBeUndefined();
    expect(parsePreviewExpiry('24H')).toBe('24h');
    expect(() => parsePreviewExpiry('2d')).toThrow('--expires must be one of 1h, 24h, 7d, 30d');
  });

  it('prints the link, a terminal QR code, and how to revoke it', async () => {
    const output = await renderPreview(preview);

    expect(output).toContain('Preview of 1.4.0 (expires 2026-10-07T10:00:00.000Z):');
    expect(output).toContain(preview.url);
    expect(output.split('\n').filter((line) => /[█▀▄]/.test(line)).length).toBeGreaterThan(10);
    expect(output).toContain('previewLinks: true');
    expect(output).toContain(`otakit preview --revoke ${preview.id}`);
  });

  it('says how to fix a link that cannot open the app yet', async () => {
    const output = await renderPreview({ ...preview, deepLink: null });
    expect(output).toContain('--scheme');
  });
});
