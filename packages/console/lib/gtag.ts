// Client-side Google tag event helpers. GA4 events always fire when the tag
// is loaded; Google Ads conversion pings additionally fire when the matching
// conversion label env var is set (Ads UI → conversion action → tag details).

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export type ConversionEvent = 'sign_up' | 'app_created' | 'release_created';

const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

const CONVERSION_LABELS: Record<ConversionEvent, string | undefined> = {
  sign_up: process.env.NEXT_PUBLIC_ADS_SIGNUP_LABEL,
  app_created: process.env.NEXT_PUBLIC_ADS_APP_CREATED_LABEL,
  release_created: process.env.NEXT_PUBLIC_ADS_RELEASE_LABEL,
};

export function trackConversion(event: ConversionEvent) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', event);
  const label = CONVERSION_LABELS[event];
  if (ADS_ID && label) {
    window.gtag('event', 'conversion', { send_to: `${ADS_ID}/${label}` });
  }
}
