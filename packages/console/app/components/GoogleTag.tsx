import Script from 'next/script';

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

// EEA + UK + Switzerland: consent defaults to denied there (Consent Mode v2);
// everywhere else defaults to granted. url_passthrough keeps the gclid alive
// across pages for consent-mode conversion modeling.
const CONSENT_DENIED_REGIONS = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IS', 'IT', 'LI', 'LV', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL',
  'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'CH',
];

export function GoogleTag() {
  const primaryId = GA_ID || ADS_ID;
  if (!primaryId) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${primaryId}`}
        strategy="afterInteractive"
      />
      <Script id="google-tag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('consent', 'default', {
            ad_storage: 'granted',
            ad_user_data: 'granted',
            ad_personalization: 'granted',
            analytics_storage: 'granted',
          });
          gtag('consent', 'default', {
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
            analytics_storage: 'denied',
            region: ${JSON.stringify(CONSENT_DENIED_REGIONS)},
          });
          gtag('set', 'ads_data_redaction', true);
          gtag('set', 'url_passthrough', true);
          gtag('js', new Date());
          ${GA_ID ? `gtag('config', '${GA_ID}');` : ''}
          ${ADS_ID ? `gtag('config', '${ADS_ID}');` : ''}
        `}
      </Script>
    </>
  );
}
