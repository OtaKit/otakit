'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DEMO_BROKEN_VERSION, DEMO_NEXT_VERSION } from '@/lib/demo/scenario';
import { DEMO_SPEEDUP } from '@/lib/demo/world';
import { cn } from '@/lib/utils';

export type DemoMission = 'release' | 'complete' | 'autoRevert';

const STEPS: Array<{ id: DemoMission; title: string; hint: string }> = [
  {
    id: 'release',
    title: `Release ${DEMO_NEXT_VERSION} to 10% of devices`,
    hint: `Press Release in the ${DEMO_NEXT_VERSION} row and roll out to 10%. Then set Events to Last 1 hour to watch it land.`,
  },
  {
    id: 'complete',
    title: 'Roll it out to every device',
    hint: `Open the base badge in the ${DEMO_NEXT_VERSION} row and choose Complete rollout.`,
  },
  {
    id: 'autoRevert',
    title: `Ship ${DEMO_BROKEN_VERSION} and let auto-revert catch it`,
    hint: `${DEMO_BROKEN_VERSION} crashes on launch. Release it with "Auto-revert if unhealthy" ticked, then watch the rollbacks.`,
  },
];

/** The demo's three steps, kept small and out of the way of the dashboard. */
export function DemoGuide({
  done,
  devices,
  onReset,
}: {
  done: ReadonlySet<DemoMission>;
  devices: number;
  onReset: () => void;
}) {
  // Open on wide screens, a bar on phones.
  const [open, setOpen] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 640px)').matches,
  );
  const next = STEPS.find((step) => !done.has(step.id));
  const finished = next === undefined;

  return (
    <aside
      aria-label="Demo guide"
      className="fixed inset-x-3 bottom-3 z-40 rounded-xl border border-border bg-background shadow-lg sm:inset-x-auto sm:left-6 sm:w-72"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold">
          {finished ? 'You shipped three releases' : 'Try it yourself'}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {done.size}/{STEPS.length}
          {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </span>
      </button>

      {open ? (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {devices.toLocaleString('en-US')} simulated devices, nothing real. Releases you make
            reach them {DEMO_SPEEDUP}× faster.
          </p>

          {finished ? (
            <p className="mt-3 text-sm leading-relaxed">
              No store review, no waiting: a release, a full rollout and a bad update caught on its
              own. That is OtaKit on your app.
            </p>
          ) : (
            <ol className="mt-3 space-y-2.5">
              {STEPS.map((step, index) => {
                const complete = done.has(step.id);
                const current = step.id === next?.id;
                return (
                  <li key={step.id} className="flex gap-2.5">
                    <span
                      className={cn(
                        'mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium',
                        complete
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : current
                            ? 'border-foreground text-foreground'
                            : 'border-border text-muted-foreground',
                      )}
                    >
                      {complete ? <Check className="size-3" /> : index + 1}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={cn(
                          'text-sm leading-5',
                          complete
                            ? 'text-muted-foreground'
                            : current
                              ? 'font-medium'
                              : 'text-muted-foreground',
                        )}
                      >
                        {step.title}
                      </p>
                      {current ? (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {step.hint}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="mt-4 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 text-muted-foreground"
              onClick={onReset}
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
            <Button asChild size="sm" className="rounded-full px-4">
              <Link href="/login">
                Start free
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
