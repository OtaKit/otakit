'use client';

import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * The small ⓘ that keeps a rule or a caveat next to its field without spending
 * a paragraph on it. Pointing at it is enough to read it; clicking pins it open
 * so it survives the mouse leaving, which is also what a tap does on a screen
 * with no hover at all.
 */
export function InfoHint({
  label,
  children,
  className,
}: {
  /** What the icon is about, for anyone who cannot see it. */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = pinned || hovered;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Escape, an outside click, or a second click on the icon.
        setPinned(next);
        if (!next) setHovered(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors',
            'hover:text-foreground focus-visible:ring-[2px] focus-visible:ring-ring/60',
            open && 'text-foreground',
            className,
          )}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
          onClick={(event) => {
            // Radix skips its own toggle once the click is defaulted-prevented,
            // so a click on an already-hovered icon pins it instead of closing.
            if (open && !pinned) {
              event.preventDefault();
              setPinned(true);
            }
          }}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        // Hovering must not move the caret out of the field being described.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="w-72 p-3 text-xs leading-relaxed text-muted-foreground"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
