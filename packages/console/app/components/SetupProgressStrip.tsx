'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, CircleAlert, Rocket, X } from 'lucide-react';

import { useStoredPreference } from '@/app/components/useStoredPreference';
import type { OnboardingSnapshot } from '@/lib/services/onboarding';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DISMISS_STORAGE_KEY = 'otakit.setup.dismissed';
const POLL_MS = 30_000;

/**
 * Loaded on the client rather than through the dashboard's server payload: an
 * organization that finished setup should not pay for a Tinybird query and a
 * CDN probe on every dashboard render, and this strip renders nothing for them.
 */
export function SetupProgressStrip() {
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null);
  const [dismissedValue, setDismissed] = useStoredPreference(DISMISS_STORAGE_KEY);
  const dismissed = dismissedValue === '1';

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        try {
          const response = await fetch('/api/v1/organization/onboarding', {
            signal: controller.signal,
          });
          if (response.ok && !stopped) {
            setSnapshot((await response.json()) as OnboardingSnapshot);
          }
        } catch {
          // Silent: this is an optional nudge, never an error surface.
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
    };

    void tick();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!snapshot || snapshot.complete || dismissed) return null;

  const blocked = snapshot.steps.device.status === 'blocked';
  const diagnosis = snapshot.steps.device.diagnosis;

  return (
    <div className={cn('border-b border-border', blocked ? 'bg-amber-500/5' : 'bg-background')}>
      <div className="mx-auto flex max-w-screen-xl items-center gap-3 px-6 py-2.5">
        {blocked ? (
          <CircleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <Rocket className="size-3.5 shrink-0 text-muted-foreground" />
        )}

        <p className="min-w-0 flex-1 truncate text-xs">
          {blocked && diagnosis ? (
            <span className="font-medium">{diagnosis.title}</span>
          ) : (
            <>
              <span className="font-medium">Setup</span>
              <span className="text-muted-foreground">
                {' '}
                · {snapshot.completedCount} of {snapshot.totalCount} done
              </span>
            </>
          )}
        </p>

        <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" asChild>
          <Link
            href={
              snapshot.app
                ? `/dashboard/setup?appId=${encodeURIComponent(snapshot.app.id)}`
                : '/dashboard/setup'
            }
          >
            {blocked ? 'Diagnose' : 'Finish setup'}
            <ArrowRight className="size-3" />
          </Link>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="size-7 shrink-0 p-0 text-muted-foreground"
          aria-label="Dismiss setup progress"
          onClick={() => setDismissed('1')}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
