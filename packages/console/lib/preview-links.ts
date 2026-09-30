/**
 * Preview links. A preview serves one bundle's signed manifest on the hidden
 * channel `__preview_<token>`; manifest paths are public, so the token is the
 * capability. Plugins report preview installs under the bare `__preview`
 * channel so tokens never reach analytics.
 */
export const PREVIEW_CHANNEL_PREFIX = '__preview';
export const PREVIEW_EXPIRY_OPTIONS = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
} as const;
export type PreviewExpiry = keyof typeof PREVIEW_EXPIRY_OPTIONS;
export const DEFAULT_PREVIEW_EXPIRY: PreviewExpiry = '7d';
export const MAX_ACTIVE_PREVIEWS_PER_APP = 20;

export const PREVIEW_TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
export const PREVIEW_TOKEN_LENGTH = 26; // 130 bits
const TOKEN_REGEX = /^[a-z2-7]{26}$/;
const URL_SCHEME_REGEX = /^[a-z][a-z0-9+.-]{0,31}$/;
const RESERVED_URL_SCHEMES = new Set(['http', 'https', 'file', 'ftp', 'data', 'javascript']);

export function isPreviewToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_REGEX.test(value);
}

export function previewChannel(token: string): string {
  return `${PREVIEW_CHANNEL_PREFIX}_${token}`;
}

/** True for preview channels and the bare `__preview` channel events report. */
export function isPreviewChannel(channel: string | null | undefined): boolean {
  return channel?.toLowerCase().startsWith(PREVIEW_CHANNEL_PREFIX) ?? false;
}

export function normalizeUrlScheme(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const scheme = value.trim().toLowerCase().replace(/:\/*$/, '');
  return URL_SCHEME_REGEX.test(scheme) && !RESERVED_URL_SCHEMES.has(scheme) ? scheme : null;
}

export function previewDeepLink(scheme: string, token: string): string {
  return `${scheme}://otakit-preview?token=${token}`;
}

export function previewExitLink(scheme: string): string {
  return `${scheme}://otakit-preview?exit=1`;
}

export function consoleOrigin(): string {
  // An empty configured value must fall through, so test truthiness, not null.
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
}

export function previewPageUrl(token: string): string {
  return `${consoleOrigin()}/p/${token}`;
}

export function previewQrUrl(token: string): string {
  return `${previewPageUrl(token)}/qr.png`;
}
