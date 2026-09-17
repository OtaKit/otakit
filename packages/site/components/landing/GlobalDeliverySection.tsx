import { CountUp } from './CountUp';
import { UpdateGlobe } from './UpdateGlobe';

const STATS: { value: number; decimals?: number; suffix: string; label: string }[] = [
  { value: 500, suffix: '+', label: 'Apps registered' },
  { value: 10_000_000, suffix: '+', label: 'Updates delivered' },
  { value: 99.99, decimals: 2, suffix: '%', label: 'Delivery uptime' },
];

export function GlobalDeliverySection() {
  return (
    <section className="border-x border-border mx-auto max-w-screen-xl">
      <div className="grid md:grid-cols-2">
        <div className="flex flex-col">
          <div className="px-8 pt-12 md:pt-20" data-blur-reveal>
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
              Global CDN delivery
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Every update, served from the nearest edge
            </h2>
            <p className="mt-4 max-w-lg text-muted-foreground">
              Fast downloads, no single point of failure.
            </p>
          </div>
          {/* The globe is wider than its panel on purpose: the lower half is
              clipped so it sinks into the bottom edge of the section. */}
          <div className="relative mt-8 h-[220px] overflow-hidden sm:h-[260px] md:mt-10 md:h-[300px]">
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-border)_1px,transparent_1px)] bg-[size:22px_22px] opacity-50 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]"
              aria-hidden="true"
            />
            <UpdateGlobe className="absolute left-1/2 top-0 w-[380px] -translate-x-1/2 md:w-[440px] lg:w-[520px]" />
          </div>
        </div>

        <div className="grid gap-px border-t border-border bg-border md:grid-rows-3 md:border-l md:border-t-0">
          {STATS.map((s) => (
            <div
              key={s.label}
              className="flex flex-col items-center justify-center bg-background px-8 py-12 text-center sm:py-14"
            >
              <div className="text-4xl font-bold tracking-tight sm:text-5xl">
                <CountUp value={s.value} decimals={s.decimals} suffix={s.suffix} />
              </div>
              <div className="mt-3 text-sm text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
