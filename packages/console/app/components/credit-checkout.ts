'use client';

import { useEffect } from 'react';

import type { ApiError } from '@/app/components/dashboard-types';
import type { CreditPack, CreditPackKey } from '@/lib/billing/credit-packs';

export type UsageSnapshot = {
  periodStart: string;
  downloadsCount: number;
  limit: number;
  effectiveLimit: number;
  percentage: number;
  creditsUsed: number;
  creditsRemaining: number;
  usageBlocked: boolean;
  warningSent: 'none' | 'at90' | 'at100';
};

export type UsagePayload = {
  usage: UsageSnapshot;
  // The pack this workspace can buy, or null (Enterprise, billing off).
  creditPack: CreditPack | null;
};

/**
 * Runs `reset` when the browser shows this page again from its back/forward
 * cache, for example after Back from the checkout: a button left busy while
 * navigating away would otherwise stay disabled.
 */
export function useResetOnPageRestore(reset: () => void): void {
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) reset();
    }
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [reset]);
}

/** Starts the Polar checkout for an extra download pack (navigates away). */
export async function startCreditCheckout(args: {
  pack: CreditPackKey;
  organizationId?: string;
}): Promise<void> {
  const response = await fetch('/api/v1/organization/billing/credits/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(args.organizationId ? { 'x-otakit-organization-id': args.organizationId } : {}),
    },
    body: JSON.stringify({ pack: args.pack }),
  });
  const data = (await response.json().catch(() => ({}))) as ApiError & { checkoutUrl?: string };
  if (!response.ok || !data.checkoutUrl) {
    throw new Error(data.error ?? 'Failed to start checkout');
  }
  window.location.href = data.checkoutUrl;
}

export type CreditConfirmation =
  | { status: 'confirmed'; payload: UsagePayload }
  | { status: 'pending'; payload: UsagePayload | null }
  | { status: 'error'; message: string };

const CONFIRM_ATTEMPTS = 8;
const CONFIRM_DELAY_MS = 2_000;

/**
 * After a pack checkout, asks the server to read the paid order from Polar
 * until the credits are applied. Webhooks usually land first; this covers
 * the rest. `pending` means the order has not been paid and applied yet.
 */
export async function confirmCreditCheckout(args: {
  organizationId: string;
  checkoutId: string | null;
  isCancelled: () => boolean;
}): Promise<CreditConfirmation> {
  let lastPayload: UsagePayload | null = null;
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, CONFIRM_DELAY_MS));
    if (args.isCancelled()) return { status: 'pending', payload: lastPayload };

    let response: Response;
    try {
      response = await fetch('/api/v1/organization/billing/credits/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-otakit-organization-id': args.organizationId,
        },
        body: JSON.stringify(args.checkoutId ? { checkoutId: args.checkoutId } : {}),
      });
    } catch {
      continue;
    }
    const data = (await response.json().catch(() => ({}))) as ApiError & {
      confirmed?: boolean;
      usage?: UsageSnapshot;
      creditPack?: CreditPack | null;
    };
    if (response.status === 409 || response.status === 401 || response.status === 403) {
      return { status: 'error', message: data.error ?? 'Reload to see your extra downloads.' };
    }
    if (!response.ok) continue;
    if (data.usage) lastPayload = { usage: data.usage, creditPack: data.creditPack ?? null };
    if (data.confirmed && lastPayload) return { status: 'confirmed', payload: lastPayload };
  }
  return { status: 'pending', payload: lastPayload };
}
