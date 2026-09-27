'use client';

import { useEffect, useRef } from 'react';

import { usePathname, useRouter } from 'next/navigation';

import { takePushIntent } from './addon-intent';
import { usePushAddon } from './use-push-addon';

/** Turns push on for people who signed up from the push landing page. */
export function PushAddonIntent({
  pushEnabled,
  canManage,
}: {
  pushEnabled: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { setEnabled } = usePushAddon();
  const handled = useRef(false);

  useEffect(() => {
    // New accounts finish onboarding before the dashboard; wait until then.
    if (handled.current || !pathname.startsWith('/dashboard')) return;
    handled.current = true;
    if (!takePushIntent() || pushEnabled || !canManage) return;
    void setEnabled(true).then(() => {
      if (pathname === '/dashboard') router.push('/dashboard/push');
    });
  }, [canManage, pathname, pushEnabled, router, setEnabled]);

  return null;
}
