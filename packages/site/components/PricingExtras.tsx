// The "Extra updates" row under the pricing cards, shared by the homepage and
// the comparison pages. Prices match the console's credit packs
// (packages/console/lib/billing/credit-packs.ts).
const EXTRAS = [
  { plan: 'Free', price: '$5', amount: 'per 5,000 updates', note: 'One-time purchase' },
  { plan: 'Starter', price: '$10', amount: 'per 100,000 updates', note: 'One-time purchase' },
  {
    plan: 'Pro',
    price: '$50',
    amount: 'per 1,000,000 updates',
    note: 'One-time, or automatic with additional usage',
  },
  { plan: 'Enterprise', price: 'Custom', amount: 'volume pricing', note: 'Part of your contract' },
];

export function PricingExtras() {
  return (
    <div className="border-t border-border">
      <div className="border-b border-border bg-background px-8 py-6">
        <h3 className="text-sm font-medium">Extra updates</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Need more in a busy month? Add a pack on top of your monthly allowance. Credits never
          expire.
        </p>
      </div>
      <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
        {EXTRAS.map((extra) => (
          <div key={extra.plan} className="bg-background px-8 py-6">
            <p className="text-sm font-medium text-muted-foreground">{extra.plan}</p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-2xl font-bold tracking-tight">{extra.price}</span>
              <span className="text-sm text-muted-foreground">{extra.amount}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{extra.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
