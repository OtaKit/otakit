'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/** At most this many new rows stream in per update; older new rows show at once. */
const MAX_STREAMED = 12;
/** New rows are spread over about the time until the next live update (ms). */
const STREAM_WINDOW_MS = 4200;
const MIN_GAP_MS = 160;
const MAX_GAP_MS = 1100;
const GLIDE_MS = 520;

/**
 * Live updates show their new events like a ticker: one row at a time slides
 * in at the top while the list glides down. Lists loaded any other way (first
 * load, a filter change) show as they are. Used by the demo's moving fleet;
 * the dashboard itself does not live-reload.
 */
export function useEventStream() {
  /** The ids of the last list received, shown or still waiting to stream in. */
  const knownIds = useRef<ReadonlySet<string>>(new Set());
  /** New rows still waiting, oldest first, so the newest ends on top. */
  const [waiting, setWaiting] = useState<string[]>([]);
  const [streamed, setStreamed] = useState<ReadonlySet<string>>(() => new Set());
  const [reveals, setReveals] = useState(0);
  const gap = useRef(MAX_GAP_MS);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  /** Call with every list loaded; `live` lists stream their new rows. */
  const receive = useCallback((events: ReadonlyArray<{ id: string }>, live: boolean) => {
    const known = knownIds.current;
    knownIds.current = new Set(events.map((event) => event.id));
    const fresh = live && known.size > 0 ? events.filter((event) => !known.has(event.id)) : [];
    const queue = fresh
      .slice(0, MAX_STREAMED)
      .map((event) => event.id)
      .reverse();
    gap.current = Math.min(
      MAX_GAP_MS,
      Math.max(MIN_GAP_MS, STREAM_WINDOW_MS / Math.max(1, queue.length)),
    );
    setWaiting(queue);
    setStreamed(new Set(queue));
  }, []);

  // Reveal the next waiting row.
  useEffect(() => {
    if (waiting.length === 0) return;
    const timer = window.setTimeout(() => {
      setWaiting((queue) => queue.slice(1));
      setReveals((count) => count + 1);
    }, gap.current);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  // Glide the list down by the new row, from wherever a running glide is.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (reveals === 0 || !body) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const height = body.rows[0]?.offsetHeight ?? 0;
    if (height === 0) return;
    const offset = new DOMMatrixReadOnly(getComputedStyle(body).transform).m42;
    for (const animation of body.getAnimations()) animation.cancel();
    body.animate(
      [{ transform: `translateY(${offset - height}px)` }, { transform: 'translateY(0)' }],
      { duration: GLIDE_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  }, [reveals]);

  const waitingIds = useMemo(() => new Set(waiting), [waiting]);
  return {
    bodyRef,
    receive,
    /** Still waiting to stream in: leave it out of the list for now. */
    isWaiting: (id: string) => waitingIds.has(id),
    /** Streamed in with the latest update: it fades in with a highlight. */
    isStreamed: (id: string) => streamed.has(id),
  };
}
