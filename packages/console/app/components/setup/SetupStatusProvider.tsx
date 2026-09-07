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
  hasExistingApps,
  children,
}: {
  userId: string;
  organizationId: string;
  hasExistingApps: boolean;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null);
  const scope = `${userId}:${organizationId}`;
  const doneKey = `otakit.setup.done:${scope}`;
  const dismissedKey = `otakit.setup.dismissed:${scope}`;
  const [doneValue, setDone] = useStoredPreference(doneKey);
  const [dismissedValue, setDismissed] = useStoredPreference(dismissedKey);
  const [legacyDone] = useStoredPreference('otakit.setup.done');
  const [legacyDismissed] = useStoredPreference('otakit.setup.dismissed');

  // Keep existing customers' choices when migrating the browser-wide flags.
  // Empty workspaces get explicit fresh values, so connecting their first app
  // later cannot make an unrelated legacy flag hide the remaining setup steps.
  const silent =
    (doneValue ?? (hasExistingApps ? legacyDone : null)) === '1' ||
    (dismissedValue ?? (hasExistingApps ? legacyDismissed : null)) === '1';

  useEffect(() => {
    try {
      // Read storage directly here: the hydration snapshot can still be null
      // even when a scoped preference already exists and must be preserved.
      if (window.localStorage.getItem(doneKey) === null) {
        setDone(
          hasExistingApps && window.localStorage.getItem('otakit.setup.done') === '1' ? '1' : '0',
        );
      }
      if (window.localStorage.getItem(dismissedKey) === null) {
        setDismissed(
          hasExistingApps && window.localStorage.getItem('otakit.setup.dismissed') === '1'
            ? '1'
            : '0',
        );
      }
    } catch {
      // Blocked browser storage leaves server-verified setup progress available.
    }
  }, [doneKey, dismissedKey, hasExistingApps, setDone, setDismissed]);

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
