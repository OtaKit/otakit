import { ImageResponse } from 'next/og';
import { site } from '@/lib/site';

export const alt = 'OtaKit — Live updates for Capacitor apps';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Branded social card, generated at build time. Mirrors the site's neutral +
// amber palette so shared links look like the marketing page.
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '80px',
        background: '#ffffff',
        backgroundImage:
          'radial-gradient(circle at 100% 0%, rgba(245,180,40,0.20), transparent 55%)',
        fontFamily: 'sans-serif',
      }}
    >
      {/* wordmark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
        <div
          style={{
            width: '84px',
            height: '84px',
            borderRadius: '20px',
            background: 'linear-gradient(160deg, #fcd34d 0%, #f59e0b 55%, #d97706 100%)',
            boxShadow: '0 16px 40px -12px rgba(245,158,11,0.6)',
          }}
        />
        <div
          style={{
            display: 'flex',
            fontSize: '60px',
            fontWeight: 700,
            letterSpacing: '-0.03em',
          }}
        >
          <span style={{ color: '#1a1714' }}>Ota</span>
          <span style={{ color: '#92836a' }}>Kit</span>
        </div>
      </div>

      {/* headline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div
          style={{
            fontSize: '76px',
            fontWeight: 600,
            lineHeight: 1.05,
            letterSpacing: '-0.03em',
            color: '#1a1714',
            maxWidth: '1000px',
          }}
        >
          Live updates for Capacitor apps
        </div>
        <div style={{ fontSize: '34px', color: '#6f6960', letterSpacing: '-0.01em' }}>
          Ship over-the-air updates — no app store reviews, open source & self-hostable.
        </div>
      </div>

      {/* install pill */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '18px 28px',
            borderRadius: '14px',
            background: '#fafaf9',
            border: '1px solid #e7e5e4',
            fontSize: '30px',
            fontFamily: 'monospace',
          }}
        >
          <span style={{ color: '#f59e0b' }}>$</span>
          <span style={{ color: '#1a1714' }}>{site.install}</span>
        </div>
      </div>
    </div>,
    { ...size },
  );
}
