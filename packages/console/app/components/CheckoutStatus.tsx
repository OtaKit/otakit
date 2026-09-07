'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';

type Status = { message: string; retry?: boolean; settings?: boolean; signIn?: boolean };

export function CheckoutStatus({ organizationId }: { organizationId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('checkout') !== 'onboarding') return;
    if (url.searchParams.get('checkout_org') !== organizationId) {
      setStatus({
        message:
          'This checkout belongs to another workspace. Switch to it in Settings to view its plan.',
        settings: true,
      });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let finishDelay: (() => void) | undefined;
    setChecking(true);
    setStatus({ message: 'Checking your subscription…' });
    async function refresh() {
      try {
        for (let check = 0; check < 3; check++) {
          if (check > 0) {
            await new Promise<void>((resolve) => {
              finishDelay = resolve;
              retryTimer = setTimeout(resolve, check * 1000);
            });
            finishDelay = undefined;
          }
          if (cancelled) return;
          const response = await fetch('/api/v1/organization/billing/refresh', {
            method: 'POST',
            headers: { 'x-otakit-organization-id': organizationId },
            signal: controller.signal,
          });
          if (cancelled) return;
          if (response.status === 401) {
            setStatus({ message: 'Sign in again to check your subscription.', signIn: true });
            return;
          }
          if (response.status === 409) {
            setStatus({
              message:
                'Your active workspace changed. Switch back in Settings to check this subscription.',
              settings: true,
            });
            return;
          }
          if (!response.ok) throw new Error('Billing refresh failed');
          const data = (await response.json()) as {
            billing?: { isActive?: boolean; planKey?: string };
          };
          if (cancelled) return;
          const plan = data.billing?.planKey;
          if (data.billing?.isActive && (plan === 'starter' || plan === 'pro')) {
            setStatus({
              message: `${plan === 'pro' ? 'Pro' : 'Starter'} is active for this workspace. You’re ready to connect your app.`,
            });
            // Only remove the return marker after the server confirms the plan.
            const current = new URL(window.location.href);
            current.searchParams.delete('checkout');
            current.searchParams.delete('checkout_org');
            window.history.replaceState(window.history.state, '', current);
            return;
          }
        }
        setStatus({
          message:
            'Your paid plan is not active yet. You can continue setting up your app and check again shortly.',
          retry: true,
        });
      } catch {
        if (!cancelled)
          setStatus({
            message: 'We couldn’t check your subscription. You can continue setup and retry here.',
            retry: true,
          });
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void refresh();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(retryTimer);
      finishDelay?.();
    };
  }, [organizationId, attempt]);

  if (!status) return null;
  return (
    <div className="border-b border-border">
      <div className="mx-auto flex max-w-screen-xl flex-wrap items-center gap-3 px-6 py-4">
        <p role="status" className="flex items-center gap-2 text-sm">
          {checking && <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />}
          {status.message}
        </p>
        {status.retry && (
          <Button
            variant="outline"
            size="sm"
            disabled={checking}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Check again
          </Button>
        )}
        {status.settings && (
          <Link className="text-sm underline underline-offset-4" href="/dashboard/settings">
            Open Settings
          </Link>
        )}
        {status.signIn && (
          <Link className="text-sm underline underline-offset-4" href="/login">
            Sign in
          </Link>
        )}
      </div>
    </div>
  );
}
