'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { SetupPanel } from './SetupPanel';
import { useSetupStatus } from './SetupStatusProvider';
import { STEP_ORDER } from './content';

/**
 * Live setup status, in the one place that is on screen everywhere: a compact
 * pill that opens the whole checklist. It disappears for good the moment the
 * first update lands, so an established account never sees it.
 */
export function SetupBadge() {
  const { snapshot, hidden, dismiss } = useSetupStatus();
  const [open, setOpen] = useState(false);

  if (hidden || !snapshot) return null;

  const blocked = snapshot.steps.device.status === 'blocked';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 rounded-full border py-1 pl-2.5 pr-3 text-xs transition-colors',
            blocked
              ? 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10'
              : 'border-border hover:bg-accent/60',
          )}
        >
          <span className="flex items-center gap-[3px]" aria-hidden>
            {STEP_ORDER.map((id) => {
              const status = snapshot.steps[id].status;
              return (
                <span
                  key={id}
                  className={cn(
                    'size-1.5 rounded-full transition-colors duration-500',
                    status === 'done' && 'bg-emerald-500',
                    status === 'blocked' && 'bg-amber-500',
                    status === 'unknown' && 'bg-muted-foreground/40',
                    status === 'active' && 'bg-foreground/60',
                    status === 'todo' && 'bg-muted-foreground/20',
                  )}
                />
              );
            })}
          </span>
          <span className="font-medium">
            {blocked
              ? 'Setup needs you'
              : `Setup ${snapshot.completedCount}/${snapshot.totalCount}`}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" sideOffset={8} className="w-[22rem] p-0">
        <SetupPanel snapshot={snapshot} />
        <div className="flex items-center justify-between border-t border-border px-3.5 py-2">
          <p className="text-[11px] text-muted-foreground">Updates on its own</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            onClick={() => {
              dismiss();
              setOpen(false);
            }}
          >
            <X className="size-3" />
            Hide
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
