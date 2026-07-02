'use client';

import { useEffect } from 'react';

import { trackConversion } from '@/lib/gtag';

// Accounts older than this never fire — covers returning users who cleared
// storage or sign in on a new device.
const SIGNUP_WINDOW_MS = 30 * 60 * 1000;

// Fires the sign_up conversion exactly once per user, on the first dashboard
// visit after account creation. Client-side because the Google tag (and the
// ad-click cookies it needs) only exist in the browser.
export function SignupTracker({ userId, createdAt }: { userId: string; createdAt: string }) {
  useEffect(() => {
    const key = `otakit:signup-tracked:${userId}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
      if (Date.now() - new Date(createdAt).getTime() > SIGNUP_WINDOW_MS) return;
      trackConversion('sign_up');
    } catch {
      // localStorage unavailable — skip rather than risk double-counting.
    }
  }, [userId, createdAt]);

  return null;
}
