import { UpdateGlobe } from './UpdateGlobe';

const DELIVERY_STEPS = [
  {
    number: '01',
    title: 'Release',
    description:
      'Publish from the CLI, the dashboard, or your AI agent. Every bundle is signed before it ships.',
  },
  {
    number: '02',
    title: 'Distribute',
    description:
      'Cloudflare serves the release from its edge network in 300+ cities. No single origin region to slow down or go offline.',
  },
  {
    number: '03',
    title: 'Update',
    description:
      'Each device downloads only the changed files from the nearest location, verifies them, and applies the update.',
  },
];

export function GlobalDeliverySection() {
  return (
    <section className="border-x border-border mx-auto max-w-screen-xl">
      <div className="overflow-hidden">
        <div className="border-b border-border px-8 py-10 pt-30">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Global delivery
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Delivered from the edge, worldwide
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            Updates reach devices from a data center near them, not from our servers. Fast in every
            region, and reliable on Cloudflare&rsquo;s global network.
          </p>
        </div>
        <div className="grid gap-px bg-border lg:grid-cols-[3fr_2fr]">
          <div className="relative overflow-hidden bg-background px-6 py-10 sm:px-10">
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-border)_1px,transparent_1px)] bg-[size:22px_22px] opacity-50 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
              aria-hidden="true"
            />
            <UpdateGlobe className="relative mx-auto max-w-[520px]" />
            <div className="relative mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full border border-foreground/60" />
                Release published
              </span>
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500" />
                Served from the nearest edge
              </span>
            </div>
          </div>
          <div className="grid gap-px bg-border">
            {DELIVERY_STEPS.map((step) => (
              <div
                key={step.number}
                className="flex flex-col justify-center bg-background p-8 sm:p-10"
              >
                <span className="font-mono text-sm text-muted-foreground/50">{step.number}</span>
                <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
