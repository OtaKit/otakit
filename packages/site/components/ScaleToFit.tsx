'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/* Renders children at a fixed `designWidth` (so they never reflow to a mobile
   layout) and scales the whole thing down to fit the available width — like a
   shrunk screenshot of the desktop view. Capped at `maxScale` so it never
   scales past its intended size on wide screens. The scaled box is centered and
   its height collapses to the scaled height (no leftover space). */
export function ScaleToFit({
  designWidth = 1152,
  maxScale = 1,
  className = '',
  children,
}: {
  designWidth?: number;
  maxScale?: number;
  className?: string;
  children: ReactNode;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(maxScale);
  // Approximate initial height to avoid a collapse before the effect runs.
  const [innerHeight, setInnerHeight] = useState(720);

  useEffect(() => {
    const measure = measureRef.current;
    const inner = innerRef.current;
    if (!measure || !inner) return;

    const update = () => {
      setScale(Math.min(maxScale, measure.clientWidth / designWidth));
      setInnerHeight(inner.offsetHeight);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(measure);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [designWidth, maxScale]);

  return (
    <div ref={measureRef} className={className}>
      <div
        className="mx-auto overflow-hidden"
        style={{ width: designWidth * scale, height: innerHeight * scale }}
      >
        <div
          ref={innerRef}
          style={{
            width: designWidth,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
