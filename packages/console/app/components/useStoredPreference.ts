'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Small UI preferences that belong to the browser rather than the account:
 * which agent the reader uses, whether they dismissed a nudge.
 *
 * Read through useSyncExternalStore rather than an effect so the server render
 * and the hydrating client agree (both see the server snapshot first), and so
 * setting a value never cascades a second render pass.
 */
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  // Keeps two tabs of the console in step.
  window.addEventListener('storage', onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

export function useStoredPreference(key: string): [string | null, (value: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        // Private windows and blocked site data read as "nothing stored".
        return null;
      }
    },
    () => null,
  );

  const set = useCallback(
    (next: string) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // A preference that cannot persist still applies for this session.
      }
      for (const listener of listeners) listener();
    },
    [key],
  );

  return [value, set];
}
