'use client';

import { useState } from 'react';
import { ChevronDown, CircleAlert, Rocket, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { SetupPanel } from './SetupPanel';
import { useSetupStatus } from './SetupStatusProvider';
import { currentStepLabel } from './content';

const TITLE_ID = 'setup-panel-title';

function ProgressBar({ pct, blocked }: { pct: number; blocked: boolean }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none',
          blocked ? 'bg-amber-500' : 'bg-primary',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * A launcher in the corner the way support widgets sit, because setup is
 * optional help rather than a wall in front of the product.
 *
 * The panel is anchored to the launcher rather than positioned next to it by
 * hand, which is what makes the awkward cases behave: it flips and shifts near
 * an edge, it knows how much room is left above the launcher and caps itself
 * there instead of running off the top, and it closes on Escape or an outside
 * click with focus going back where it came from. Collapsing the launcher to a
 * pill while the panel is open keeps one progress bar on screen, not two.
 *
 * It removes itself for good once the first update lands.
 */
export function SetupLauncher() {
  const { snapshot, hidden, dismiss } = useSetupStatus();
  const [choice, setChoice] = useState<boolean | null>(null);

  // Open on its own for an account that has done nothing yet, decided once from
  // the first snapshot. `completedCount === 0` stops being true the moment the
  // first step lands, and the panel must not slam shut while it is being used.
  const [autoOpen, setAutoOpen] = useState<boolean | null>(null);
  if (snapshot && autoOpen === null) {
    setAutoOpen(snapshot.completedCount === 0);
  }

  const open = choice ?? autoOpen === true;

  if (hidden || !snapshot) return null;

  const blocked = snapshot.steps.device.status === 'blocked';
  const label = currentStepLabel(snapshot);
  // A snapshot with no steps is not something this can render a fraction of.
  const pct = snapshot.totalCount
    ? Math.round((snapshot.completedCount / snapshot.totalCount) * 100)
    : 0;

  return (
    <Popover open={open} onOpenChange={setChoice}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'group fixed bottom-4 right-4 z-40 rounded-2xl border bg-background text-left shadow-lg outline-none sm:bottom-6 sm:right-6',
            'transition-[transform,box-shadow,padding] duration-200 motion-reduce:transition-none',
            'focus-visible:ring-[3px] focus-visible:ring-ring/50',
            open
              ? 'p-2.5'
              : 'w-[16.5rem] max-w-[calc(100vw-2rem)] p-3.5 hover:-translate-y-0.5 hover:shadow-xl',
            blocked ? 'border-amber-500/50' : 'border-border',
          )}
        >
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                'flex shrink-0 items-center justify-center rounded-xl transition-[width,height] duration-200 motion-reduce:transition-none',
                open ? 'size-6' : 'size-8',
                blocked ? 'bg-amber-500/15' : 'bg-primary/10',
              )}
            >
              {blocked ? (
                <CircleAlert
                  className={cn('text-amber-600 dark:text-amber-400', open ? 'size-3.5' : 'size-4')}
                />
              ) : (
                <Rocket className={cn('text-primary', open ? 'size-3.5' : 'size-4')} />
              )}
            </span>

            {open ? (
              <>
                <span className="text-[13px] font-medium leading-tight">Set up OtaKit</span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold leading-tight">
                    Set up OtaKit
                  </span>
                  <span className="block truncate text-xs leading-tight text-muted-foreground">
                    {label}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                  {snapshot.completedCount}/{snapshot.totalCount}
                </span>
              </>
            )}
          </div>

          {open ? null : (
            <div className="mt-3">
              <ProgressBar pct={pct} blocked={blocked} />
            </div>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        collisionPadding={16}
        aria-labelledby={TITLE_ID}
        // Opening by itself must not take the caret out of whatever the reader
        // was doing; opening because they clicked should land focus in here.
        onOpenAutoFocus={(event) => {
          if (choice === null) event.preventDefault();
        }}
        className={cn(
          'flex w-[23rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl p-0 shadow-xl',
          'max-h-[var(--radix-popover-content-available-height)]',
        )}
      >
        <div className="shrink-0 space-y-2.5 border-b border-border px-4 pb-3.5 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={TITLE_ID} className="text-sm font-semibold leading-tight">
                Set up OtaKit
              </h2>
              <p className="mt-0.5 text-xs leading-tight text-muted-foreground" aria-live="polite">
                {snapshot.completedCount} of {snapshot.totalCount} done · checked off as they happen
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="-mr-1.5 -mt-1 shrink-0 text-muted-foreground"
              aria-label="Close setup"
              onClick={() => setChoice(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <ProgressBar pct={pct} blocked={blocked} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <SetupPanel snapshot={snapshot} />
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/20 px-4 py-2">
          <p className="text-[11px] text-muted-foreground">Checks in the background</p>
          <Button
            variant="ghost"
            size="xs"
            className="text-[11px] text-muted-foreground"
            onClick={() => {
              dismiss();
              setChoice(false);
            }}
          >
            Hide for good
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
