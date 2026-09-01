import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { site } from '@/lib/site';

export const alt = 'OtaKit — Ship app updates instantly, without App Store reviews';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Inter + JetBrains Mono, subset to printable ASCII so the four faces cost
// ~150KB total. Satori has no system fonts to fall back on: without real font
// data every weight collapses to one limp fallback face, which is what made
// the previous card look unbranded.
const FONT_DIR = join(process.cwd(), 'app', '_fonts');

async function loadFonts() {
  const [regular, semibold, bold, mono] = await Promise.all([
    readFile(join(FONT_DIR, 'inter-latin-400.ttf')),
    readFile(join(FONT_DIR, 'inter-latin-600.ttf')),
    readFile(join(FONT_DIR, 'inter-latin-700.ttf')),
    readFile(join(FONT_DIR, 'jetbrains-mono-latin-500.ttf')),
  ]);

  return [
    { name: 'Inter', data: regular, weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: semibold, weight: 600 as const, style: 'normal' as const },
    { name: 'Inter', data: bold, weight: 700 as const, style: 'normal' as const },
    { name: 'JetBrains Mono', data: mono, weight: 500 as const, style: 'normal' as const },
  ];
}

// Mirrors the marketing site's identity: the black circular refresh mark, a
// zinc-neutral type scale, and emerald as the sole accent.
const INK = '#09090b';
const MUTED = '#71717a';
const FAINT = '#a1a1aa';
const HAIRLINE = '#e4e4e7';
const EMERALD = '#10b981';

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '72px',
          background: '#ffffff',
          // One soft emerald bloom off the bottom-right corner, echoing the
          // "live" accent without tinting the type.
          backgroundImage:
            'radial-gradient(45% 55% at 100% 100%, rgba(16,185,129,0.10), transparent 70%)',
          fontFamily: 'Inter',
        }}
      >
        {/* Brand row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
            <svg width="60" height="60" viewBox="0 0 600 600" fill="none">
              <circle cx="300" cy="300" r="300" fill={INK} />
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
                fontSize: '40px',
                fontWeight: 600,
                letterSpacing: '-0.025em',
                color: INK,
              }}
            >
              OtaKit
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '11px',
              padding: '11px 22px',
              borderRadius: '9999px',
              background: 'rgba(16,185,129,0.08)',
              border: `1px solid rgba(16,185,129,0.25)`,
              fontSize: '23px',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              color: '#047857',
            }}
          >
            <div
              style={{
                width: '11px',
                height: '11px',
                borderRadius: '9999px',
                background: EMERALD,
              }}
            />
            Open source
          </div>
        </div>

        {/* Headline block, optically centred in the space the rows leave over.
            Lines are split by hand so the rag stays balanced instead of
            orphaning a word. */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: '76px',
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: '-0.035em',
              color: INK,
            }}
          >
            <div style={{ display: 'flex' }}>Ship app updates instantly</div>
            <div style={{ display: 'flex' }}>without App Store reviews.</div>
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: '28px',
              fontSize: '30px',
              fontWeight: 400,
              lineHeight: 1.4,
              letterSpacing: '-0.011em',
              color: MUTED,
            }}
          >
            Over-the-air updates for Capacitor apps &mdash; self-hostable, MIT licensed.
          </div>
        </div>

        {/* Install command + domain, anchored under a hairline */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: `1px solid ${HAIRLINE}`,
            paddingTop: '34px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              fontSize: '25px',
              fontFamily: 'JetBrains Mono',
              fontWeight: 500,
            }}
          >
            <span style={{ color: EMERALD }}>$</span>
            <span style={{ color: '#3f3f46' }}>{site.install}</span>
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: '25px',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              color: FAINT,
            }}
          >
            otakit.app
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await loadFonts() },
  );
}
