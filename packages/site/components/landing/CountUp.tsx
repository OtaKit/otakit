'use client';

import { useEffect, useRef } from 'react';

const DURATION_MS = 1600;

function format(value: number, decimals: number) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Shows `value` and counts up to it from zero the first time it scrolls into
 * view. The server renders the final figure, so crawlers, visitors without JS,
 * and reduced-motion users always see the real number. The animation writes
 * the text node directly instead of re-rendering React on every frame.
 */
export function CountUp({
  value,
  decimals = 0,
  suffix = '',
}: {
  value: number;
  decimals?: number;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Already on screen when the page loads (e.g. restored scroll): keep the real number.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) return;

    const render = (current: number) => {
      el.textContent = `${format(current, decimals)}${suffix}`;
    };
    render(0);

    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / DURATION_MS);
          render(value * (1 - (1 - progress) ** 3));
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.5 },
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      render(value);
    };
  }, [value, decimals, suffix]);

  return (
    <span ref={ref} className="tabular-nums">
      {format(value, decimals)}
      {suffix}
    </span>
  );
}
