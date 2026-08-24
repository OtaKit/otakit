'use client';

import { useEffect, useState } from 'react';
import { Building2, Check, ChevronDown, Leaf, LoaderCircle, Rocket, Star } from 'lucide-react';
import { toast } from 'sonner';

import type { ApiError } from '@/app/components/dashboard-types';
import { SUPPORT_MAILTO } from '@/lib/support';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type PlanKey = 'free' | 'starter' | 'pro' | 'enterprise';

type BillingInterval = 'month' | 'year';

export type PricingDialogBillingData = {
  billing: {
    planKey: PlanKey;
    isActive: boolean;
    downloadsLimit: number;
    polarCustomerId: string | null;
  };
};

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function PricingDialog({
  open,
  onOpenChange,
  canManageBilling,
  initialBillingData,
  onBillingDataChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManageBilling: boolean;
  initialBillingData?: PricingDialogBillingData | null;
  onBillingDataChange?: (billingData: PricingDialogBillingData) => void;
}) {
  const [billingData, setBillingData] = useState<PricingDialogBillingData | null>(
    initialBillingData ?? null,
  );
  const [checkingOut, setCheckingOut] = useState<'starter' | 'pro' | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    setBillingData(initialBillingData ?? null);
    // Re-sync only when the meaningful billing fields change, not on every parent
    // re-render that hands us a fresh object identity (which would clobber state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialBillingData?.billing.planKey,
    initialBillingData?.billing.isActive,
    initialBillingData?.billing.downloadsLimit,
    initialBillingData?.billing.polarCustomerId,
  ]);

  useEffect(() => {
    if (!open) return;

    const url = new URL(window.location.href);
    let changed = false;
    let checkoutSuccess = false;
    if (url.searchParams.get('pricing') === '1') {
      url.searchParams.delete('pricing');
      changed = true;
    }
    if (url.searchParams.get('checkout') === 'success') {
      url.searchParams.delete('checkout');
      changed = true;
      checkoutSuccess = true;
      toast.success('Subscription activated!');
    }
    if (changed) {
      const query = url.searchParams.toString();
      window.history.replaceState({}, '', `${url.pathname}${query ? `?${query}` : ''}`);
    }

    const needsRefresh = checkoutSuccess || !billingData;
    if (!needsRefresh) return;

    let cancelled = false;
    const hasInitialSnapshot = Boolean(billingData);

    async function refreshBilling() {
      try {
        const res = await fetch('/api/v1/organization/billing/refresh', { method: 'POST' });
        if (!res.ok) throw new Error('Failed to load billing');
        const data = await parseJson<PricingDialogBillingData>(res);
        if (cancelled) return;
        setBillingData(data);
        onBillingDataChange?.(data);
      } catch {
        if (!hasInitialSnapshot) {
          toast.error('Failed to load billing');
        }
      }
    }

    void refreshBilling();

    return () => {
      cancelled = true;
    };
  }, [open, billingData, onBillingDataChange]);

  const currentPlan = billingData?.billing.planKey ?? 'free';
  const hasActiveSubscription = Boolean(
    billingData?.billing.isActive &&
    (currentPlan === 'starter' || currentPlan === 'pro') &&
    billingData.billing.polarCustomerId,
  );
  const hasLegacyFreeAllowance =
    currentPlan === 'free' && (billingData?.billing.downloadsLimit ?? 0) >= 100_000;

  async function handleCheckout(
    planKey: Extract<PlanKey, 'starter' | 'pro'>,
    billingInterval: BillingInterval,
  ) {
    if (!canManageBilling) return;
    setCheckingOut(planKey);
    try {
      const res = await fetch('/api/v1/organization/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey, interval: billingInterval }),
      });
      const data = await parseJson<ApiError & { checkoutUrl?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? 'Failed to start checkout');
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start checkout');
    } finally {
      setCheckingOut(null);
    }
  }

  async function handleManageBilling() {
    if (!canManageBilling) return;
    setOpeningPortal(true);
    try {
      const res = await fetch('/api/v1/organization/billing/portal');
      const data = await parseJson<ApiError & { portalUrl?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? 'Failed to open billing portal');
      if (data.portalUrl) window.open(data.portalUrl, '_blank');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to open billing portal');
    } finally {
      setOpeningPortal(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto p-8 sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Pricing</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {hasLegacyFreeAllowance ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Your workspace keeps its grandfathered Free allowance of 100,000 downloads per month.
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <PlanCard
              name="Free"
              price="$0"
              priceNote="forever"
              subtitle={
                hasLegacyFreeAllowance
                  ? '100,000 downloads / month (grandfathered)'
                  : '5,000 downloads / month*'
              }
              features={[
                'Unlimited updates',
                'Unlimited apps',
                'Channel-based releases',
                'Dashboard + CLI',
              ]}
              current={currentPlan === 'free'}
              actionLabel="Current plan"
              actionIcon={Leaf}
              disabled
            />

            <PlanCard
              name="Starter"
              price="$10"
              priceNote="billed monthly only"
              subtitle="100,000 downloads / month*"
              features={[
                'Everything in Free',
                '20× update capacity',
                'Single-member workspace',
                'Hard cap — no overage',
              ]}
              current={currentPlan === 'starter'}
              tag="Most popular"
              actionLabel={
                currentPlan === 'starter'
                  ? 'Current plan'
                  : hasLegacyFreeAllowance
                    ? 'Included in your Free plan'
                    : hasActiveSubscription
                      ? 'Manage subscription'
                      : 'Choose Starter'
              }
              actionIcon={Rocket}
              disabled={!canManageBilling || hasLegacyFreeAllowance}
              loading={openingPortal || checkingOut === 'starter'}
              onAction={
                currentPlan === 'starter'
                  ? undefined
                  : hasLegacyFreeAllowance
                    ? undefined
                    : hasActiveSubscription
                      ? () => void handleManageBilling()
                      : () => void handleCheckout('starter', 'month')
              }
              highlighted
            />

            <PlanCard
              name="Pro"
              price="$25"
              priceNote="billed $300/year — save 50%"
              subtitle="1,000,000 downloads / month*"
              features={[
                'Everything in Free',
                'Team members and roles',
                'Usage-based overage ($50 / extra 1M)',
                'Priority support',
              ]}
              current={currentPlan === 'pro'}
              tag="Best value"
              actionLabel={
                currentPlan === 'pro'
                  ? 'Current plan'
                  : hasActiveSubscription
                    ? 'Manage subscription'
                    : `Upgrade to Pro`
              }
              actionIcon={Star}
              disabled={!canManageBilling}
              loading={openingPortal || checkingOut === 'pro'}
              actionItems={
                currentPlan !== 'pro' && !hasActiveSubscription
                  ? [
                      {
                        label: 'Yearly',
                        description: '$300/year · $25/month · save 50%',
                        onSelect: () => void handleCheckout('pro', 'year'),
                      },
                      {
                        label: 'Monthly',
                        description: '$50/month',
                        onSelect: () => void handleCheckout('pro', 'month'),
                      },
                    ]
                  : undefined
              }
              onAction={
                currentPlan === 'pro'
                  ? undefined
                  : hasActiveSubscription
                    ? () => void handleManageBilling()
                    : undefined
              }
            />

            <PlanCard
              name="Enterprise"
              price="Custom"
              priceNote="tailored to your volume"
              subtitle="Custom download volume"
              features={[
                'Everything in Pro',
                'Custom limits & contract',
                'SSO & priority SLAs',
                'Dedicated support',
              ]}
              current={currentPlan === 'enterprise'}
              actionLabel={currentPlan === 'enterprise' ? 'Current plan' : 'Contact sales'}
              actionIcon={Building2}
              disabled={currentPlan === 'enterprise'}
              onAction={
                currentPlan === 'enterprise'
                  ? undefined
                  : () => {
                      window.location.href = `${SUPPORT_MAILTO}?subject=${encodeURIComponent(
                        'OtaKit Enterprise plan',
                      )}`;
                    }
              }
            />
          </div>

          {!canManageBilling ? (
            <p className="text-sm text-muted-foreground">
              Only organization owners/admins can manage billing.
            </p>
          ) : null}

          <p className="text-sm text-muted-foreground">
            * Value-aligned pricing: pay for real downloaded updates. Free and Starter stop at their
            included limits. Optional Pro overage is $50 per additional 1,000,000 downloads.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanCard({
  name,
  price,
  priceNote,
  subtitle,
  features,
  current,
  actionLabel,
  actionIcon: ActionIcon,
  disabled = false,
  loading = false,
  onAction,
  actionItems,
  highlighted = false,
  tag,
}: {
  name: string;
  price: string;
  priceNote?: string;
  subtitle: string;
  features: string[];
  current: boolean;
  actionLabel: string;
  actionIcon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  loading?: boolean;
  onAction?: () => void;
  actionItems?: Array<{
    label: string;
    description: string;
    onSelect: () => void;
  }>;
  highlighted?: boolean;
  tag?: string;
}) {
  const isMoney = price.startsWith('$');
  return (
    <div
      className={`rounded-lg border bg-card p-5 flex flex-col ${
        highlighted ? 'border-foreground/30 shadow-sm' : 'border-border'
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{name}</p>
          {tag ? (
            <Badge variant="secondary" className="text-[11px]">
              {tag}
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 flex items-end gap-1">
          <span className="text-3xl font-semibold tracking-tight">{price}</span>
          {isMoney ? <span className="pb-1 text-sm text-muted-foreground">/mo</span> : null}
        </div>
        {priceNote ? <p className="mt-1 text-xs text-muted-foreground">{priceNote}</p> : null}
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <ul className="mt-5 space-y-2">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
            <Check className="mt-0.5 size-3.5 shrink-0 text-foreground" />
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-5">
        {actionItems && actionItems.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="w-full"
                variant={highlighted ? 'default' : 'outline'}
                disabled={disabled || loading}
              >
                {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {!loading ? <ActionIcon className="size-3.5" /> : null}
                {actionLabel}
                <ChevronDown className="ml-auto size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {actionItems.map((item) => (
                <DropdownMenuItem
                  key={item.label}
                  className="items-start py-2.5"
                  onSelect={item.onSelect}
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.description}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            className="w-full"
            variant={current ? 'outline' : highlighted ? 'default' : 'outline'}
            disabled={current || disabled || !onAction}
            onClick={onAction}
          >
            {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {!loading ? <ActionIcon className="size-3.5" /> : null}
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
