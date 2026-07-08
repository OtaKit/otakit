import { ImageResponse } from 'next/og';
import { site } from '@/lib/site';

export const alt = 'OtaKit — Live updates for Capacitor apps';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Branded social card, generated at build time. Mirrors the marketing site's
// actual identity: the black circular refresh mark, a single-color wordmark,
// zinc-neutral type, and emerald as the sole accent — no invented palette.
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '84px',
        background: '#ffffff',
        // Barely-there depth: a cool neutral wash top-right, a faint emerald
        // glow bottom-left that echoes the "live" status accent.
        backgroundImage:
          'radial-gradient(60% 60% at 100% 0%, rgba(24,24,27,0.05), transparent 70%), radial-gradient(50% 55% at 0% 100%, rgba(16,185,129,0.08), transparent 70%)',
        fontFamily: 'sans-serif',
      }}
    >
      {/* top row: real logo + wordmark, live status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '22px' }}>
          <svg width="80" height="80" viewBox="0 0 600 600" fill="none">
            <circle cx="300" cy="300" r="300" fill="#09090b" />
            <g transform="translate(58 58) scale(20.1666666667)">
              <path
                d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"
                fill="none"
                stroke="#ECECEC"
                strokeWidth="2.26"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M21 3v5h-5"
                fill="none"
                stroke="#ECECEC"
                strokeWidth="2.26"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          </svg>
          <div
            style={{
              display: 'flex',
              fontSize: '54px',
              fontWeight: 600,
              letterSpacing: '-0.03em',
              color: '#18181b',
            }}
          >
            OtaKit
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 22px',
            borderRadius: '9999px',
            background: 'rgba(16,185,129,0.10)',
            border: '1px solid rgba(16,185,129,0.28)',
            fontSize: '26px',
            fontWeight: 500,
            color: '#047857',
          }}
        >
          <div
            style={{
              width: '14px',
              height: '14px',
              borderRadius: '9999px',
              background: '#10b981',
            }}
          />
          Live updates
        </div>
      </div>

      {/* headline: mirrors the hero's foreground→foreground/40 gradient text */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div
          style={{
            display: 'flex',
            fontSize: '82px',
            fontWeight: 600,
            lineHeight: 1.02,
            letterSpacing: '-0.035em',
            maxWidth: '980px',
            backgroundImage: 'linear-gradient(180deg, #18181b 0%, rgba(24,24,27,0.55) 100%)',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          Live updates for Capacitor apps
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: '33px',
            lineHeight: 1.3,
            letterSpacing: '-0.01em',
            color: '#71717a',
            maxWidth: '900px',
          }}
        >
          Ship over-the-air updates — no app store reviews. Open source &amp; self-hostable.
        </div>
      </div>

      {/* bottom row: install command + domain */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '18px 28px',
            borderRadius: '14px',
            background: '#fafafa',
            border: '1px solid #e4e4e7',
            fontSize: '29px',
            fontFamily: 'monospace',
          }}
        >
          <span style={{ color: '#10b981' }}>$</span>
          <span style={{ color: '#18181b' }}>{site.install}</span>
        </div>
        <div style={{ display: 'flex', fontSize: '28px', color: '#a1a1aa', letterSpacing: '-0.01em' }}>
          otakit.app
        </div>
      </div>
    </div>,
    { ...size },
  );
}
