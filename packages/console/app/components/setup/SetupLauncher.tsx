'use client';

import { useEffect, useState } from 'react';
import { CircleAlert, Rocket, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { SetupPanel } from './SetupPanel';
import { useSetupStatus } from './SetupStatusProvider';
import { currentStepLabel } from './content';

/**
 * A launcher in the corner the way support widgets sit, because setup is
 * optional help rather than a wall in front of the product. Collapsed it is a
 * compact status; clicking grows it, from that same corner, into the checklist.
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

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChoice(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (hidden || !snapshot) return null;

  const blocked = snapshot.steps.device.status === 'blocked';
  const label = currentStepLabel(snapshot);
  const pct = Math.round((snapshot.completedCount / snapshot.totalCount) * 100);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setChoice(true)}
        aria-expanded={false}
        className={cn(
          'group fixed bottom-6 right-6 z-40 w-[16.5rem] rounded-2xl border bg-background p-3.5 text-left shadow-lg',
          'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl',
          blocked ? 'border-amber-500/50' : 'border-border',
        )}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-xl',
              blocked ? 'bg-amber-500/15' : 'bg-primary/10',
            )}
          >
            {blocked ? (
              <CircleAlert className="size-4 text-amber-600 dark:text-amber-400" />
            ) : (
              <Rocket className="size-4 text-primary" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight">Set up OtaKit</p>
            <p className="truncate text-xs leading-tight text-muted-foreground">{label}</p>
          </div>
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
            {snapshot.completedCount}/{snapshot.totalCount}
          </span>
        </div>

        <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              blocked ? 'bg-amber-500' : 'bg-primary',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Set up OtaKit"
      className={cn(
        'fixed bottom-6 right-6 z-40 flex max-h-[calc(100svh-6rem)] w-[23rem] max-w-[calc(100vw-3rem)] flex-col',
        'origin-bottom-right overflow-hidden rounded-2xl border border-border bg-background shadow-2xl',
        'duration-200 animate-in fade-in zoom-in-95 slide-in-from-bottom-2',
      )}
    >
      <div className="shrink-0 px-5 pb-3.5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold leading-tight">Set up OtaKit</p>
            <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
              {snapshot.completedCount} of {snapshot.totalCount} done · checked off as they happen
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="-mr-2 -mt-1 size-7 shrink-0 p-0 text-muted-foreground"
            aria-label="Close setup"
            onClick={() => setChoice(false)}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              blocked ? 'bg-amber-500' : 'bg-primary',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SetupPanel snapshot={snapshot} />
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-2.5">
        <p className="text-[11px] text-muted-foreground">Updates on its own</p>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px] text-muted-foreground"
          onClick={() => {
            dismiss();
            setChoice(false);
          }}
        >
          Hide setup
        </Button>
      </div>
    </div>
  );
}
