import { UpdateGlobe } from './UpdateGlobe';

export function GlobalDeliverySection() {
  return (
    <section className="border-x border-border mx-auto max-w-screen-xl">
      <div className="grid md:grid-cols-2">
        <div className="flex flex-col justify-center px-8 py-12 md:py-16">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Global delivery
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Every update, served from the nearest edge
          </h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            Releases are served from Cloudflare&rsquo;s network in 300+ cities. Every device
            downloads from a location close by, never from a single origin server.
          </p>
        </div>
        {/* The globe is larger than its panel on purpose: the lower half is
            clipped so it sinks under the next section. */}
        <div className="relative h-[300px] overflow-hidden md:h-auto md:min-h-[360px] lg:min-h-[400px]">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-border)_1px,transparent_1px)] bg-[size:22px_22px] opacity-50 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]"
            aria-hidden="true"
          />
          <UpdateGlobe className="absolute left-1/2 -top-2 w-[380px] -translate-x-1/2 md:-top-3 md:w-[460px] lg:-top-4 lg:w-[560px]" />
        </div>
      </div>
    </section>
  );
}
