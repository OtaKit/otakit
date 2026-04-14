import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, BookOpen, Check, Lock, Rocket, Shield, Users, Zap, Globe } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'OtaKit — Live updates for Capacitor apps',
  description:
    'Ship instant over-the-air updates to your Capacitor apps. No app store delays. Open source and self-hostable.',
};

type HeroIconCloudItem = {
  src: string;
  top: string;
  left?: string;
  right?: string;
  size: number;
  opacity: number;
  rotate: number;
};

const HERO_ICON_CLOUD: HeroIconCloudItem[] = [
  {
    src: '/app-icons/time-tracking.svg',
    top: '9%',
    left: '6%',
    size: 54,
    opacity: 0.12,
    rotate: -18,
  },
  { src: '/app-icons/ai-chat.svg', top: '16%', left: '27%', size: 72, opacity: 0.09, rotate: 14 },
  {
    src: '/app-icons/calorie-tracking.svg',
    top: '10%',
    right: '16%',
    size: 64,
    opacity: 0.1,
    rotate: -8,
  },
  { src: '/app-icons/recording.svg', top: '28%', left: '72%', size: 46, opacity: 0.08, rotate: 22 },
  { src: '/app-icons/fitness.svg', top: '52%', right: '8%', size: 94, opacity: 0.06, rotate: -20 },
  { src: '/app-icons/budget.svg', top: '70%', left: '58%', size: 52, opacity: 0.09, rotate: -10 },
  {
    src: '/app-icons/habit-tracker.svg',
    top: '78%',
    right: '22%',
    size: 78,
    opacity: 0.06,
    rotate: 12,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground m-3 border border-border">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/60 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-screen-xl items-center gap-6 px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logo.svg"
              alt="OtaKit"
              width={24}
              height={24}
              className="size-6 rounded-md"
            />
            <span className="text-[15px] font-semibold tracking-tight">OtaKit</span>
          </Link>
          <nav className="ml-auto flex items-center gap-1">
            <Link
              href="#pricing"
              className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
            >
              Pricing
            </Link>
            <Link
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Docs
            </Link>
            <div className="ml-3 flex items-center gap-2">
              <Link href="/dashboard">
                <Button variant="ghost" size="sm">
                  Dashboard
                </Button>
              </Link>
              <Link href="/login">
                <Button size="sm" className="rounded-full px-4">
                  Sign Up
                </Button>
              </Link>
            </div>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden pb-24 pt-32 sm:pb-32 sm:pt-44 border-x border-border max-w-screen-xl mx-auto">
        {/* Grid background */}
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-border)_1.5px,transparent_1.5px)] bg-[size:28px_28px] opacity-60"
          aria-hidden="true"
        />
        {/* App icon cloud */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {HERO_ICON_CLOUD.map((icon, index) => (
            <Image
              key={index}
              src={icon.src}
              alt=""
              width={icon.size}
              height={icon.size}
              className="absolute select-none rounded-[22%]"
              style={{
                top: icon.top,
                left: icon.left,
                right: icon.right,
                opacity: icon.opacity,
                transform: `rotate(${icon.rotate}deg)`,
              }}
            />
          ))}
        </div>
        {/* Top fade */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent"
          aria-hidden="true"
        />
        {/* Bottom fade */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent"
          aria-hidden="true"
        />

        <div className="relative mx-auto max-w-screen-xl p-10">
          <div className="max-w-3xl">
            {/* <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-4 py-1.5 text-[13px] text-muted-foreground ring-1 ring-inset ring-emerald-500/10">
              <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
              Open source &amp; self-hostable
            </div> */}
            <h1 className="text-6xl font-bold">
              Ship app updates instantly
              {/* <br />
              <span className="bg-gradient-to-b from-foreground to-foreground/40 bg-clip-text text-transparent">
                not app store reviews
              </span> */}
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground sm:text-xl">
              Push updates directly to your Capacitor app without app store reviews.
            </p>
            <div className="mt-20 flex flex-col items-start gap-4 sm:flex-row">
              <div>
                <Link href="/login">
                  <Button size="lg" className="group rounded-full px-8">
                    Start releasing free
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </Link>
                <p className="mt-1 text-xs text-muted-foreground/60 text-center hidden sm:block">
                  No credit card required.
                </p>
              </div>
              <Link href="/docs" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="lg" className="rounded-full px-8">
                  <BookOpen className="size-4" />
                  Read the docs
                </Button>
              </Link>
            </div>
          </div>
        </div>
        <div className="absolute bottom-1 left-1 text-muted-foreground/60 text-xs">
          Fully compliant with Apple App Store and Google Play policies.
        </div>
      </section>

      <Separator className="" />

      {/* CLI */}
      <section className="border-x border-border max-w-screen-xl mx-auto">
        <div className="">
          <div className="overflow-hidden">
            <div className="border-b border-border px-8 py-10 pt-30">
              <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                How it works
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                Over-The-Air updates for Capacitor
              </h2>
              <p className="mt-4 max-w-lg text-muted-foreground">
                Simple setup and fast release flow with the OtaKit CLI.
              </p>
            </div>
            <div className="grid gap-px bg-border sm:grid-cols-3">
              <StepCard
                number="01"
                title="Install"
                description="Add the OtaKit plugin to your Capacitor app."
                code="npm install @otakit/capacitor-plugin"
              />
              <StepCard
                number="02"
                title="Upload"
                description="Build your app and upload it."
                code="otakit upload"
              />
              <StepCard
                number="03"
                title="Go live"
                description="Push your update live instantly."
                code="otakit release"
              />
            </div>
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* Dashboard */}
      <section className="border-x border-border mx-auto max-w-screen-xl">
        <div className="">
          <div className="overflow-hidden">
            {/* Header */}
            <div className="border-b border-border px-8 py-10 pt-30">
              <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                Dashboard
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                Everything in one click
              </h2>
              <p className="mt-4 max-w-lg text-muted-foreground">
                A full-featured web dashboard to manage and monitor your releases.
              </p>
            </div>
            {/* Dashboard mockup */}
            <div className="overflow-hidden bg-[linear-gradient(180deg,rgba(245,245,240,0.9)_0%,rgba(250,250,248,0.98)_54%,rgba(255,255,255,1)_100%)] px-6 pt-8 dark:bg-[linear-gradient(180deg,rgba(18,18,16,0.96)_0%,rgba(12,12,11,0.98)_54%,rgba(10,10,9,1)_100%)]">
              <div className="mx-auto max-w-6xl [perspective:2200px]">
                <div className="relative origin-top [transform:rotateX(7deg)_scale(1)]">
                  <div className="pointer-events-none absolute inset-x-[10%] top-4 h-24 rounded-full bg-foreground/10 blur-3xl opacity-20" />
                  <div className="overflow-hidden rounded-t-2xl border border-border/80 bg-background pt-3 shadow-[0_56px_150px_-72px_rgba(15,23,42,0.65)]">
                    <Image
                      src="/dashboard-preview.png"
                      alt="OtaKit dashboard preview showing bundles, releases, and events"
                      width={3290}
                      height={1778}
                      priority
                      sizes="(min-width: 1536px) 1400px, (min-width: 1280px) 1200px, (min-width: 768px) 92vw, 100vw"
                      className="block h-auto w-full"
                    />
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-b from-transparent via-white/70 to-background dark:via-background/75 dark:to-background" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* Features */}
      <section id="features" className="border-x border-border mx-auto max-w-screen-xl">
        <div className="">
          <div className="overflow-hidden">
            <div className="border-b border-border px-8 py-10 pt-30">
              <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                Features
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                Everything you need for live updates
              </h2>
              <p className="mt-4 max-w-lg text-muted-foreground">
                A complete OTA platform for Capacitor teams of any size.
              </p>
            </div>
            <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={Zap}
                title="Instant delivery"
                description="Updates land on devices in seconds. Fix critical bugs the moment you find them — no app store review."
              />
              <FeatureCard
                icon={Rocket}
                title="Channel-based releases"
                description="Release bundles to production, staging, or custom channels. Roll back instantly if something goes wrong."
              />
              <FeatureCard
                icon={Shield}
                title="App Store compliant"
                description="OTA updates for web layers only — fully compliant with Apple and Google guidelines for Capacitor apps."
              />
              <FeatureCard
                icon={Lock}
                title="Secure by default"
                description="SHA-256 bundle verification, signed manifests, HTTPS enforcement, and delivieries via Cloudflare CDN."
              />
              <FeatureCard
                icon={Users}
                title="Team & API keys"
                description="Invite members, assign roles, and manage scoped API keys per organization."
              />
              <FeatureCard
                icon={Globe}
                title="Open source"
                description="Fully open-source core. Self-host on your own infrastructure or use our managed service. No vendor lock-in."
              />
            </div>
          </div>
        </div>
      </section>


      <Separator className="" />

      {/* Pricing */}
      <section id="pricing" className="border-x border-border mx-auto max-w-screen-xl">
        <div className="">
          <div className="overflow-hidden">
            <div className="border-b border-border px-8 py-10 pt-30">
              <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                Pricing
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                Simple, value-aligned pricing
              </h2>
              <p className="mt-4 max-w-lg text-muted-foreground">
                Pricing is based on real downloads - not seats or end-user tracking.
              </p>
            </div>
            <div className="grid gap-px bg-border sm:grid-cols-3">
              <PricingCard
                name="Starter"
                price="$0"
                period="/mo"
                description="Free tier for early usage."
                allowance="1,000 downloads / month*"
                features={[
                  'Unlimited updates',
                  'Unlimited apps',
                  'Unlimited users',
                  'Channel-based deploys',
                  'Dashboard + CLI',
                ]}
                cta="Get started free"
              />
              <PricingCard
                name="Pro"
                price="$19"
                period="/mo"
                description="For growing apps."
                allowance="100,000 downloads / month*"
                features={['Everything in Starter', 'Team members & roles', 'Priority support']}
                cta="Start with Pro"
                highlighted
              />
              <PricingCard
                name="Scale"
                price="$99"
                period="/mo"
                description="For apps at production scale."
                allowance="1,000,000 downloads / month included*"
                features={[
                  'Everything in Pro',
                  'Best value for high-volume apps',
                  'Usage-based top-ups',
                ]}
                cta="Get started"
              />
            </div>
            <p className="border-t border-border px-8 py-5 text-center text-sm text-muted-foreground/60">
              Need more usage? Add an extra 1,000,000 downloads for $99, or{' '}
              <Link href="/contact" className="underline underline-offset-4 hover:text-foreground">
                contact us
              </Link>{' '}
              for a custom plan.
            </p>
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* CTA */}
      <section className="relative overflow-hidden border-x border-border mx-auto max-w-screen-xl py-32 px-10 bg-muted">
        {/* Checked grid background */}
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--color-border)_1px,transparent_1px),linear-gradient(90deg,var(--color-border)_1px,transparent_1px)] bg-[size:40px_40px] opacity-50"
          aria-hidden="true"
        />
        {/* Top fade */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background to-transparent"
          aria-hidden="true"
        />
        {/* Bottom fade */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent"
          aria-hidden="true"
        />
        <div className="relative">
          <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">Ready to ship faster?</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Push over-the-air updates directly to your users without delays.
          </p>
          <div className="mt-20 flex flex-col items-center gap-4 sm:flex-row">
            <Link href="/login">
              <Button size="lg" className="group rounded-full px-8">
                Get started free
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
            <Link href="/docs" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="lg" className="rounded-full px-8">
                <BookOpen className="size-4" />
                Documentation
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* Footer */}
      <footer className="border-x border-border mx-auto max-w-screen-xl">
        <div className="mx-auto flex max-w-screen-xl flex-col items-center gap-6 px-6 py-8 sm:flex-row sm:justify-between">
          <div className="flex min-w-0 max-w-sm items-center gap-2.5 text-center sm:max-w-none sm:text-left">
            <Image src="/logo.svg" alt="OtaKit" width={20} height={20} className="size-5 rounded" />
            <span className="text-sm leading-relaxed text-muted-foreground">
              OtaKit for Capacitor apps
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground sm:justify-end">
            <Link
              href="/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Docs
            </Link>
            <Link
              href="https://github.com/OtaKit/otakit"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              GitHub
            </Link>
            <Link href="#pricing" className="transition-colors hover:text-foreground">
              Pricing
            </Link>
            <Link href="/dashboard" className="transition-colors hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/contact" className="transition-colors hover:text-foreground">
              Contact
            </Link>
            <Link href="/docs/security" className="transition-colors hover:text-foreground">
              Security
            </Link>
            <Link href="/terms" className="transition-colors hover:text-foreground">
              Terms
            </Link>
            <Link href="/policy" className="transition-colors hover:text-foreground">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─── Sub-components ───────────────────────────────────────────────── */

function StepCard({
  number,
  title,
  description,
  code,
}: {
  number: string;
  title: string;
  description: string;
  code: string;
}) {
  return (
    <div className="bg-background p-8 sm:p-10">
      <span className="font-mono text-sm text-muted-foreground/50">{number}</span>
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-background/50 px-4 py-3 font-mono text-[12px] text-muted-foreground bg-muted">
        <span className="opacity-50">$ </span>
        {code}
      </pre>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="group bg-background p-8 transition-colors hover:bg-muted/95 sm:p-10">
      <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
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
}: {
  name: string;
  price: string;
  period: string;
  description: string;
  allowance: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
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
          <span className="text-sm text-muted-foreground">{period}</span>
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
        <Link href="/login" className="block">
          <Button variant={highlighted ? 'default' : 'outline'} className="w-full">
            {cta}
          </Button>
        </Link>
      </div>
    </div>
  );
}
