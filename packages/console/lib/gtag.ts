// Client-side Google tag event helpers. GA4 events always fire when the tag
// is loaded; Google Ads conversion pings additionally fire when the matching
// conversion label env var is set (Ads UI → conversion action → tag details).

declare global {
  interface Window {
    dataLayer?: unknown[];
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

// gtag.js only processes Arguments objects pushed to the dataLayer, so this
// must be a plain function using `arguments` — not an array push.
function queueForGtag() {
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer!.push(arguments);
}

// Safe at any time relative to the tag scripts: if gtag.js hasn't executed
// yet, the event is queued on the dataLayer and drained when it loads.
function gtagCall(...args: unknown[]) {
  window.dataLayer = window.dataLayer || [];
  const gtag = typeof window.gtag === 'function' ? window.gtag : queueForGtag;
  gtag(...args);
}

export function trackConversion(event: ConversionEvent) {
  if (typeof window === 'undefined') return;
  gtagCall('event', event);
  const label = CONVERSION_LABELS[event];
  if (ADS_ID && label) {
    gtagCall('event', 'conversion', { send_to: `${ADS_ID}/${label}` });
  }
}
