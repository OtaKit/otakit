'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useStoredPreference } from '@/app/components/useStoredPreference';
import type { OnboardingSnapshot } from '@/lib/services/onboarding';

/** Quick while a device is expected to report in, unhurried otherwise. */
const POLL_WAITING_MS = 5_000;
const POLL_IDLE_MS = 20_000;

type SetupStatus = {
  snapshot: OnboardingSnapshot | null;
  /** True once setup is finished or the user put the badge away. */
  hidden: boolean;
  dismiss: () => void;
};

const SetupStatusContext = createContext<SetupStatus>({
  snapshot: null,
  hidden: true,
  dismiss: () => {},
});

export function useSetupStatus(): SetupStatus {
  return useContext(SetupStatusContext);
}

/**
 * One poll for the whole dashboard, so the header badge and any inline panel
 * read the same snapshot instead of each asking the server themselves.
 *
 * Finishing setup is monotonic, so the first complete snapshot is remembered
 * and this stops asking altogether — otherwise every dashboard visit, forever,
 * would pay an analytics query for a checklist that has been green for months.
 */
export function SetupStatusProvider({
  userId,
  organizationId,
  children,
}: {
  userId: string;
  organizationId: string;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null);
  // Legacy browser-wide flags cannot identify which account or workspace was
  // finished or dismissed. Ignore them so a fresh workspace can show its help.
  const scope = `${userId}:${organizationId}`;
  const [doneValue, setDone] = useStoredPreference(`otakit.setup.done:${scope}`);
  const [dismissedValue, setDismissed] = useStoredPreference(`otakit.setup.dismissed:${scope}`);

  const silent = doneValue === '1' || dismissedValue === '1';

  useEffect(() => {
    if (silent) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      let waiting = false;
      if (document.visibilityState === 'visible') {
        try {
          const response = await fetch('/api/v1/organization/onboarding', {
            signal: controller.signal,
            headers: { 'x-otakit-organization-id': organizationId },
            cache: 'no-store',
          });
          if (response.status === 409 && !stopped) {
            // Another tab switched workspaces. Its progress must not be saved
            // as completion of the workspace still shown in this tab.
            setSnapshot(null);
            return;
          }
          if (response.ok && !stopped) {
            const next = (await response.json()) as OnboardingSnapshot;
            if (stopped) return;
            setSnapshot(next);
            if (next.complete) {
              setDone('1');
              return;
            }
            waiting = next.steps.device.status !== 'todo';
          }
        } catch {
          // A dropped poll is not worth surfacing; the next tick recovers.
        }
      }
      if (!stopped) {
        timer = setTimeout(() => void tick(), waiting ? POLL_WAITING_MS : POLL_IDLE_MS);
      }
    };

    void tick();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [silent, setDone, organizationId]);

  return (
    <SetupStatusContext.Provider
      value={{
        snapshot,
        hidden: silent || !snapshot || snapshot.complete,
        dismiss: () => setDismissed('1'),
      }}
    >
      {children}
    </SetupStatusContext.Provider>
  );
}
