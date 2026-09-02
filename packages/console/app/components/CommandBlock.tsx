'use client';

import { CopyButton } from '@/app/components/CopyButton';
import { cn } from '@/lib/utils';

/**
 * The one way this console shows something you have to run or paste. The setup
 * checklist and the connect dialog both use it, so a command looks the same
 * wherever you meet it and the copy control is always in the same corner —
 * rather than each surface inventing its own block, button and reveal toggle.
 *
 * `wrap` is the difference between a command and a prompt: a shell line keeps
 * its shape and scrolls, a sentence written for an agent reflows.
 */
export function CommandBlock({
  value,
  label,
  wrap = false,
  className,
}: {
  value: string;
  label: string;
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // min-w-0 is what keeps a long command inside its container: a grid or
        // flex track sizes to its content, so without it the overflow lands in
        // the dialog instead of in this block.
        // A solid surface, not a tint: the fade below has to be able to match
        // it exactly, and a translucent one changes with whatever is behind.
        'relative min-w-0 overflow-hidden rounded-lg border border-border bg-muted',
        className,
      )}
    >
      <pre
        className={cn(
          'overflow-x-auto py-2.5 pl-3 pr-11 font-mono text-[11px] leading-relaxed text-foreground/90',
          wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
        )}
      >
        <code>{value}</code>
      </pre>
      {/* A line long enough to scroll would otherwise run out under the button.
          The fade covers that, and doubles as the hint that there is more. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-px right-px w-12 bg-gradient-to-l from-muted from-55% to-transparent"
      />
      {/* Anchored to the block rather than to the scroller, so it holds its
          corner while the line underneath moves. */}
      <CopyButton
        value={value}
        label={label}
        className="absolute right-1 top-1 size-7 bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
      />
    </div>
  );
}
