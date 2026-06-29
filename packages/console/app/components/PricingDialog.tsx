'use client';

import { useEffect, useState } from 'react';
import { Building2, Check, Leaf, LoaderCircle, Star } from 'lucide-react';
import { toast } from 'sonner';

import type { ApiError } from '@/app/components/dashboard-types';
import { SUPPORT_MAILTO } from '@/lib/support';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type PlanKey = 'free' | 'pro' | 'enterprise';

type BillingInterval = 'month' | 'year';

export type PricingDialogBillingData = {
  billing: {
    planKey: PlanKey;
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
  const [interval, setInterval] = useState<BillingInterval>('year');
  const [checkingOut, setCheckingOut] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  useEffect(() => {
    setBillingData(initialBillingData ?? null);
    // Re-sync only when the meaningful billing fields change, not on every parent
    // re-render that hands us a fresh object identity (which would clobber state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBillingData?.billing.planKey, initialBillingData?.billing.polarCustomerId]);

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
  const hasPolarCustomer = Boolean(billingData?.billing.polarCustomerId);

  async function handleCheckout(billingInterval: BillingInterval) {
    if (!canManageBilling) return;
    setCheckingOut(true);
    try {
      const res = await fetch('/api/v1/organization/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey: 'pro', interval: billingInterval }),
      });
      const data = await parseJson<ApiError & { checkoutUrl?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? 'Failed to start checkout');
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start checkout');
    } finally {
      setCheckingOut(false);
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

  const proPrice = interval === 'year' ? '$25' : '$50';
  const proPriceNote = interval === 'year' ? 'billed $300/year — save 50%' : 'billed monthly';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl p-8">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Pricing</DialogTitle>
            <BillingIntervalToggle value={interval} onChange={setInterval} />
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <PlanCard
              name="Free"
              price="$0"
              priceNote="forever"
              subtitle="10,000 downloads / month*"
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
              name="Pro"
              price={proPrice}
              priceNote={proPriceNote}
              subtitle="1,000,000 downloads / month*"
              features={[
                'Everything in Free',
                'Team members and roles',
                'Usage-based overage ($50 / extra 1M)',
                'Priority support',
              ]}
              current={currentPlan === 'pro'}
              tag="Most popular"
              actionLabel={
                currentPlan === 'pro'
                  ? 'Current plan'
                  : hasPolarCustomer
                    ? 'Manage subscription'
                    : `Upgrade to Pro`
              }
              actionIcon={Star}
              disabled={!canManageBilling}
              loading={openingPortal || checkingOut}
              onAction={
                currentPlan === 'pro'
                  ? undefined
                  : hasPolarCustomer
                    ? () => void handleManageBilling()
                    : () => void handleCheckout(interval)
              }
              highlighted
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
            * Value-aligned pricing: pay for real downloaded updates. Overage on Pro is billed at
            $50 per additional 1,000,000 downloads and can be turned off to cap spend.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BillingIntervalToggle({
  value,
  onChange,
}: {
  value: BillingInterval;
  onChange: (value: BillingInterval) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border p-0.5 text-xs">
      <button
        type="button"
        onClick={() => onChange('month')}
        className={`rounded-full px-3 py-1 transition-colors ${
          value === 'month' ? 'bg-foreground text-background' : 'text-muted-foreground'
        }`}
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange('year')}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${
          value === 'year' ? 'bg-foreground text-background' : 'text-muted-foreground'
        }`}
      >
        Yearly
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            value === 'year' ? 'bg-background/20' : 'bg-muted text-foreground'
          }`}
        >
          -50%
        </span>
      </button>
    </div>
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
      </div>
    </div>
  );
}
