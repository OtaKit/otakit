import type { ToolEnvelope } from './contracts';

type Preview = {
  bundleVersion: string;
  expiresAt: string;
  url: string;
  qrUrl: string;
  deepLink: string | null;
};

/** Envelope parts for a created preview link, shared by the local and remote servers. */
export function previewEnvelopeParts(
  preview: Preview,
): Pick<ToolEnvelope, 'summary' | 'warnings' | 'links' | 'nextActions'> {
  return {
    summary: `Created a preview link for bundle ${preview.bundleVersion}, valid until ${preview.expiresAt}: ${preview.url}`,
    warnings: [
      ...(preview.deepLink
        ? []
        : [
            "The app's URL scheme is not known yet, so the link cannot open the app. Create the preview again with urlScheme set to the app's custom URL scheme.",
          ]),
      'The link opens only in builds of the app with OtaKit plugin 3.2 or later and previewLinks: true in the OtaKit plugin config.',
    ],
    links: [
      { label: 'Preview link', url: preview.url },
      { label: 'QR code', url: preview.qrUrl },
    ],
    nextActions: [
      'Share the preview link; the tester opens it on the phone with the app installed.',
    ],
  };
}
