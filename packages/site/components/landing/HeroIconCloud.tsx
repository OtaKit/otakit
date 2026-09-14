import type { CSSProperties } from 'react';
import Image from 'next/image';

type HeroIcon = {
  src: string;
  top: string;
  left?: string;
  right?: string;
  size: number;
  opacity: number;
  rotate: number;
  // Drift: x/y offset (px), rotation delta (deg), cycle length (s).
  dx: number;
  dy: number;
  dr: number;
  dur: number;
  // Opacity pulse cycle length (s), kept out of step with the drift.
  pulse: number;
};

const HERO_ICONS: HeroIcon[] = [
  {
    src: '/app-icons/time-tracking.svg',
    top: '9%',
    left: '6%',
    size: 54,
    opacity: 0.12,
    rotate: -18,
    dx: 11,
    dy: -14,
    dr: 4,
    dur: 7.5,
    pulse: 11,
  },
  {
    src: '/app-icons/ai-chat.svg',
    top: '16%',
    left: '27%',
    size: 72,
    opacity: 0.09,
    rotate: 14,
    dx: -10,
    dy: -9,
    dr: -4.5,
    dur: 9,
    pulse: 13.5,
  },
  {
    src: '/app-icons/calorie-tracking.svg',
    top: '10%',
    right: '16%',
    size: 64,
    opacity: 0.1,
    rotate: -8,
    dx: 14,
    dy: 11,
    dr: 3,
    dur: 6.5,
    pulse: 9.5,
  },
  {
    src: '/app-icons/recording.svg',
    top: '28%',
    left: '72%',
    size: 46,
    opacity: 0.08,
    rotate: 22,
    dx: -9,
    dy: 13,
    dr: 5,
    dur: 8.5,
    pulse: 12.5,
  },
  {
    src: '/app-icons/fitness.svg',
    top: '52%',
    right: '8%',
    size: 94,
    opacity: 0.06,
    rotate: -20,
    dx: 15,
    dy: -11,
    dr: -3.5,
    dur: 7,
    pulse: 14,
  },
  {
    src: '/app-icons/budget.svg',
    top: '70%',
    left: '58%',
    size: 52,
    opacity: 0.09,
    rotate: -10,
    dx: -13,
    dy: -10,
    dr: 4,
    dur: 8,
    pulse: 10.5,
  },
  {
    src: '/app-icons/habit-tracker.svg',
    top: '78%',
    right: '22%',
    size: 78,
    opacity: 0.06,
    rotate: 12,
    dx: 10,
    dy: 14,
    dr: -3,
    dur: 6,
    pulse: 12,
  },
];

// The pulse animates the icon between 55% and 100% of this peak, so each icon
// breathes around its base opacity (see .hero-icon in globals.css).
const PULSE_PEAK = 1.3;

/** Decorative app icons behind the landing hero, slowly drifting and breathing. */
export function HeroIconCloud() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {HERO_ICONS.map((icon, index) => (
        <div
          key={icon.src}
          className="absolute"
          style={{
            top: icon.top,
            left: icon.left,
            right: icon.right,
            opacity: icon.opacity * PULSE_PEAK,
            transform: `rotate(${icon.rotate}deg)`,
          }}
        >
          <Image
            src={icon.src}
            alt=""
            width={icon.size}
            height={icon.size}
            className="hero-icon block select-none rounded-[22%]"
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
