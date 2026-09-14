'use client';

import { useEffect } from 'react';

/**
 * Blur-in reveal for every `[data-blur-reveal]` block on the page: its children
 * fade in from blurred and slightly lowered, staggered (see globals.css).
 *
 * Blocks are only hidden here, after hydration, and only if they start below
 * the fold, so the server HTML, visitors without JS, and reduced-motion users
 * always get plain visible text. Render once per page.
 */
export function BlurRevealObserver() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // The first child is the top line of text (eyebrow or heading), so the
    // reveal starts as soon as any of the block's text reaches the viewport.
    const firstLine = (block: HTMLElement) => block.firstElementChild ?? block;
    const blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-blur-reveal]')).filter(
      (block) => firstLine(block).getBoundingClientRect().top > window.innerHeight,
    );
    for (const block of blocks) block.dataset.blurReveal = 'hidden';

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const block = entry.target.closest<HTMLElement>('[data-blur-reveal]');
          if (block) block.dataset.blurReveal = 'shown';
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -2% 0px' },
    );
    for (const block of blocks) observer.observe(firstLine(block));

    return () => {
      observer.disconnect();
      for (const block of blocks) block.dataset.blurReveal = '';
    };
  }, []);

  return null;
}
