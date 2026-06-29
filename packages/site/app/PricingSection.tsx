'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { site } from '@/lib/site';

type BillingInterval = 'month' | 'year';

export function PricingSection() {
  const [interval, setInterval] = useState<BillingInterval>('year');
  const yearly = interval === 'year';

  return (
    <section id="pricing" className="border-x border-border mx-auto max-w-screen-xl">
      <div>
        <div className="overflow-hidden">
          <div className="border-b border-border px-8 py-10 pt-30">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                  Pricing
                </p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                  Simple, value-aligned pricing
                </h2>
                <p className="mt-4 max-w-3xl text-muted-foreground">
                  Pricing is based on live updates delivered — no seats, end-user tracking,
                  bandwidth, or storage.
                </p>
              </div>
              <BillingIntervalToggle value={interval} onChange={setInterval} />
            </div>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-3">
            <PricingCard
              name="Free"
              price="$0"
              period="/mo"
              description="Free forever for early usage."
              allowance="10,000 updates / month"
              features={[
                'Unlimited releases',
                'Unlimited apps',
                'Channel-based deploys',
                'Dashboard + CLI',
                'Real-time analytics',
              ]}
              cta="Get started free"
            />
            <PricingCard
              name="Pro"
              price={yearly ? '$25' : '$50'}
              period="/mo"
              description={yearly ? 'Billed yearly ($300/yr).' : 'Billed monthly.'}
              allowance="1,000,000 updates / month"
              features={[
                'Everything in Free',
                'Team members & roles',
                'Usage-based overage ($50 / extra 1M)',
                'Priority support',
              ]}
              cta="Start with Pro"
              highlighted
            />
            <PricingCard
              name="Enterprise"
              price="Custom"
              period=""
              description="For apps at production scale."
              allowance="Custom download volume"
              features={[
                'Everything in Pro',
                'Custom limits & contract',
                'SSO & priority SLAs',
                'Dedicated support',
              ]}
              cta="Contact sales"
              href="/contact"
            />
          </div>
        </div>
      </div>
    </section>
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
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background p-0.5 text-sm">
      <button
        type="button"
        onClick={() => onChange('month')}
        className={`rounded-full px-3.5 py-1.5 transition-colors ${
          value === 'month' ? 'bg-foreground text-background' : 'text-muted-foreground'
        }`}
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange('year')}
        className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-colors ${
          value === 'year' ? 'bg-foreground text-background' : 'text-muted-foreground'
        }`}
      >
        Yearly
        <span
          className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
            value === 'year' ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-700'
          }`}
        >
          −50%
        </span>
      </button>
    </div>
  );
}

function PricingCard({
  name,
  price,
  period,
  description,
  allowance,
  features,
  cta,
  highlighted,
  href,
}: {
  name: string;
  price: string;
  period: string;
  description: string;
  allowance: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
  href?: string;
}) {
  return (
    <div
      className={`relative flex flex-col p-8 transition-colors ${
        highlighted ? 'bg-emerald-50' : 'bg-background'
      }`}
    >
      {highlighted && <div className="absolute inset-x-0 top-0 h-0.5 bg-emerald-500" />}
      {highlighted && (
        <div className="absolute top-3 right-2 inline-flex w-fit items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
          Recommended
        </div>
      )}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground">{name}</h3>
        <div className="mt-4 flex items-baseline gap-1">
          <span className="text-4xl font-bold tracking-tight">{price}</span>
          {period ? <span className="text-sm text-muted-foreground">{period}</span> : null}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{description}</p>
        <p className="mt-1 text-sm font-medium">{allowance}</p>
      </div>
      <ul className="mt-8 flex-1 space-y-3">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <Link href={href ?? `${site.console}/login`} className="block">
          <Button variant={highlighted ? 'default' : 'outline'} className="w-full">
            {cta}
          </Button>
        </Link>
      </div>
    </div>
  );
}
