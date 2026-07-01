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
  cropBottom = 0,
  className = '',
  boxClassName = '',
  children,
}: {
  designWidth?: number;
  maxScale?: number;
  /** Design pixels to hide off the bottom (content is clipped). Expressed in
      design space so the crop scales with the content — a fixed outer margin
      would eat a much bigger fraction of the preview on small screens. */
  cropBottom?: number;
  className?: string;
  /** Applied to the (unscaled) clip box — good for a frame/border/shadow that
      should stay 1px and wrap the scaled content without being clipped. */
  boxClassName?: string;
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

    // Measure the content height exactly ONCE. After this we never react to it
    // again, so streaming/animation inside the box can never resize it (which
    // would rescale and jitter the whole section). offsetHeight is unscaled, so
    // the box height (innerHeight * scale) still recomputes on resize.
    setInnerHeight(inner.offsetHeight);

    const updateScale = () => setScale(Math.min(maxScale, measure.clientWidth / designWidth));
    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [designWidth, maxScale]);

  return (
    <div ref={measureRef} className={className}>
      <div
        className={`mx-auto overflow-hidden ${boxClassName}`}
        style={{
          // content-box so the frame border sits OUTSIDE the scaled content and
          // can't be covered by the content overflowing right/down (the scale
          // origin is top-left).
          boxSizing: 'content-box',
          width: Math.round(designWidth * scale),
          height: Math.round(Math.max(0, innerHeight - cropBottom) * scale),
        }}
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
