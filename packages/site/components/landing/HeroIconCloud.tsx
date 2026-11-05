import type { CSSProperties } from 'react';
import Image from 'next/image';

type HeroIcon = {
  src: string;
  // Icon center, in % of the hero's width / height.
  x: number;
  y: number;
  size: number;
  // "near" icons are larger and stronger, "far" ones smaller and fainter,
  // which gives the cloud some depth.
  depth: 'near' | 'far';
  rotate: number;
  // Drift: x/y offset (px), rotation delta (deg), cycle length (s).
  dx: number;
  dy: number;
  dr: number;
  dur: number;
  // Opacity pulse cycle length (s), kept out of step with the drift.
  pulse: number;
  // Shown on every screen size. The rest appear from lg up, where the side
  // gutters next to the centered copy are wide enough to keep them off text.
  always?: boolean;
  // Fixed offset from the top (px) instead of y. Used by the two corner icons
  // so they stay above the badge however tall the hero gets on small screens.
  topPx?: number;
};

// A symmetric frame around the centered hero copy: one icon in each top corner
// (above the badge), then a column down each side that fans out toward the
// bottom, following the copy as it narrows from headline to buttons.
const HERO_ICONS: HeroIcon[] = [
  // Left
  {
    src: '/app-icons/time-tracking.svg',
    x: 15,
    y: 0,
    topPx: 116,
    size: 58,
    depth: 'near',
    rotate: -12,
    dx: 11,
    dy: -12,
    dr: 4,
    dur: 7.5,
    pulse: 11,
    always: true,
  },
  {
    src: '/app-icons/notes.svg',
    x: 30,
    y: 21,
    size: 40,
    depth: 'far',
    rotate: 8,
    dx: -8,
    dy: 9,
    dr: -3,
    dur: 8.5,
    pulse: 12.5,
  },
  {
    src: '/app-icons/ai-chat.svg',
    x: 6.5,
    y: 41,
    size: 66,
    depth: 'near',
    rotate: 10,
    dx: -10,
    dy: -9,
    dr: -4.5,
    dur: 9,
    pulse: 13.5,
  },
  {
    src: '/app-icons/fitness.svg',
    x: 18,
    y: 61,
    size: 46,
    depth: 'far',
    rotate: -14,
    dx: 12,
    dy: 10,
    dr: 3.5,
    dur: 7,
    pulse: 10,
  },
  {
    src: '/app-icons/music.svg',
    x: 9,
    y: 80,
    size: 54,
    depth: 'near',
    rotate: 6,
    dx: -9,
    dy: -11,
    dr: 3,
    dur: 8,
    pulse: 14,
  },
  // Right
  {
    src: '/app-icons/calorie-tracking.svg',
    x: 85,
    y: 0,
    topPx: 106,
    size: 60,
    depth: 'near',
    rotate: 10,
    dx: 13,
    dy: 10,
    dr: 3,
    dur: 6.5,
    pulse: 9.5,
    always: true,
  },
  {
    src: '/app-icons/budget.svg',
    x: 70,
    y: 22,
    size: 42,
    depth: 'far',
    rotate: -8,
    dx: -11,
    dy: -8,
    dr: 4,
    dur: 9.5,
    pulse: 11.5,
  },
  {
    src: '/app-icons/recording.svg',
    x: 93.5,
    y: 39,
    size: 52,
    depth: 'far',
    rotate: -16,
    dx: -9,
    dy: 12,
    dr: 5,
    dur: 8.5,
    pulse: 12.5,
  },
  {
    src: '/app-icons/habit-tracker.svg',
    x: 81,
    y: 59,
    size: 64,
    depth: 'near',
    rotate: 12,
    dx: 10,
    dy: 12,
    dr: -3,
    dur: 6,
    pulse: 12,
  },
  {
    src: '/app-icons/weather.svg',
    x: 92,
    y: 81,
    size: 44,
    depth: 'far',
    rotate: -6,
    dx: 12,
    dy: -9,
    dr: -3.5,
    dur: 7.8,
    pulse: 10.8,
  },
];

const DEPTH_OPACITY = { near: 0.42, far: 0.24 } as const;

// The pulse animates the icon between 55% and 100% of this peak, so each icon
// breathes around its base opacity (see .hero-icon in globals.css).
const PULSE_PEAK = 1.3;

/** Decorative app icons framing the landing hero, slowly drifting and breathing. */
export function HeroIconCloud() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {HERO_ICONS.map((icon, index) => (
        <div
          key={icon.src}
          className={icon.always ? 'absolute' : 'absolute hidden lg:block'}
          style={{
            left: `${icon.x}%`,
            top: icon.topPx === undefined ? `${icon.y}%` : `${icon.topPx}px`,
            opacity: DEPTH_OPACITY[icon.depth] * PULSE_PEAK,
            transform: `translate(-50%, -50%) rotate(${icon.rotate}deg)`,
          }}
        >
          <Image
            src={icon.src}
            alt=""
            width={icon.size}
            height={icon.size}
            className={`hero-icon block select-none rounded-[22%] ${
              icon.depth === 'near' ? 'drop-shadow-[0_10px_16px_rgba(15,23,42,0.18)]' : ''
            }`}
            style={
              {
                animationDuration: `${icon.dur}s, ${icon.pulse}s`,
                animationDelay: `${-(index * 1.7)}s, ${-(index * 2.9)}s`,
                '--dx': `${icon.dx}px`,
                '--dy': `${icon.dy}px`,
                '--dr': `${icon.dr}deg`,
              } as CSSProperties
            }
          />
        </div>
      ))}
    </div>
  );
}
