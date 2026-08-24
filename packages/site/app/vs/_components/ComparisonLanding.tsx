import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Check,
  FileDiff,
  Lock,
  Rocket,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  Users,
  Zap,
  Globe,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { CopyEmailLink } from '@/components/CopyEmailLink';
import { DashboardPreview } from '@/components/DashboardPreview';
import { ScaleToFit } from '@/components/ScaleToFit';
import { site } from '@/lib/site';

// Same skeleton as the homepage (app/page.tsx) — only the copy varies per
// competitor. Keep layout/section changes in sync with the homepage.

export type ComparisonCopy = {
  /** Competitor display name, e.g. "Capgo" — used in the note labels. */
  competitor: string;
  heroTitle: React.ReactNode;
  heroSub: React.ReactNode;
  /** One short sentence for the sticky-note under "How it works". */
  migrationNote?: React.ReactNode;
  featuresTitle: string;
  featuresSub: string;
  /** Price rows for the sticky-note under "Pricing": [scenario, OtaKit, competitor]. */
  priceComparison?: { rows: string[][]; href: string };
  ctaTitle: string;
  ctaSub: string;
  faq: { q: string; a: React.ReactNode }[];
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

const STATS: { value: string; label: string }[] = [
  { value: '100+', label: 'Apps registered' },
  { value: '1,000,000+', label: 'Updates delivered' },
  { value: '99.99%', label: 'Delivery uptime' },
];

// Inline code style for use inside FAQ answers.
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">
      {children}
    </code>
  );
}

export function ComparisonLanding({ copy }: { copy: ComparisonCopy }) {
  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground m-3 border border-border">
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
            <Link
              href="/blog"
              className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
            >
              Blog
            </Link>
            <div className="ml-3 flex items-center gap-2">
              <Link href={`${site.console}/dashboard`}>
                <Button variant="ghost" size="sm">
                  Dashboard
                </Button>
              </Link>
              <Link href={`${site.console}/login`}>
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
            <h1 className="text-6xl font-bold max-w-3xl">{copy.heroTitle}</h1>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground sm:text-xl">
              {copy.heroSub}
            </p>
            <div className="mt-20 flex flex-col items-start gap-4 sm:flex-row">
              <div>
                <Link href={`${site.console}/login`}>
                  <Button size="lg" className="group rounded-full px-8">
                    <span className="shimmer">Start releasing free</span>
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
      <section className="relative border-x border-border max-w-screen-xl mx-auto">
        {copy.migrationNote && (
          <aside className="absolute -right-8 top-28 z-10 hidden w-fit max-w-sm -rotate-2 rounded-xl border border-dashed border-yellow-300/80 bg-yellow-50 px-5 py-4 shadow-lg lg:block">
            <p className="text-xs font-medium uppercase tracking-widest text-yellow-800">
              Switching from {copy.competitor}?
            </p>
            <p className="mt-2 text-sm leading-relaxed text-yellow-900">{copy.migrationNote}</p>
          </aside>
        )}
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
                description="Add the OtaKit plugin to your Capacitor app and publish once to the stores."
                code="npm install @otakit/capacitor-plugin"
              />
              <StepCard
                number="02"
                title="Upload"
                description="Make changes, build your app, and upload the new web bundle to OtaKit."
                code="otakit upload"
              />
              <StepCard
                number="03"
                title="Go live"
                description="Devices with your app installed pick up the update silently in the background."
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
              <p className="mt-4 max-w-2xl text-muted-foreground">
                A full-featured web dashboard to manage and monitor your releases in real-time.
              </p>
            </div>
            {/* Dashboard mockup — tilted back in 3D, with its flat bottom edge
                clipped so it slides under the next section (no rounded bottom). */}
            <div className="overflow-hidden bg-[linear-gradient(180deg,rgba(245,245,240,0.9)_0%,rgba(250,250,248,0.98)_54%,rgba(255,255,255,1)_100%)] px-6 pt-8 [perspective:2200px] dark:bg-[linear-gradient(180deg,rgba(18,18,16,0.96)_0%,rgba(12,12,11,0.98)_54%,rgba(10,10,9,1)_100%)]">
              <div className="relative mx-auto max-w-6xl origin-top [transform:rotateX(7deg)]">
                <div className="pointer-events-none absolute inset-x-[10%] top-4 h-24 rounded-full bg-foreground/10 opacity-20 blur-3xl" />
                <ScaleToFit
                  designWidth={1152}
                  maxScale={0.8}
                  cropBottom={72}
                  boxClassName="rounded-t-2xl border border-border bg-background shadow-[0_56px_150px_-72px_rgba(15,23,42,0.65)]"
                >
                  <DashboardPreview />
                </ScaleToFit>
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
                {copy.featuresTitle}
              </h2>
              <p className="mt-4 max-w-lg text-muted-foreground">{copy.featuresSub}</p>
            </div>
            <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={Zap}
                title="Instant delivery"
                description="Updates land on devices in seconds — no store review. Force-immediate releases apply on the very next check."
              />
              <FeatureCard
                icon={FileDiff}
                title="Delta updates"
                description="Devices download only the files that changed between releases. Asset-heavy apps update in kilobytes, not megabytes."
              />
              <FeatureCard
                icon={ShieldAlert}
                title="Safe rollouts"
                description="Broken updates roll back automatically, and the CLI catches native-compatibility mistakes before a release ever ships."
              />
              <FeatureCard
                icon={Rocket}
                title="Channel-based releases"
                description="Release to production, beta, or custom channels — switchable at runtime. Roll back any channel instantly."
              />
              <FeatureCard
                icon={SlidersHorizontal}
                title="Custom update experience"
                description="Silent and automatic out of the box — or hook into update events to ask before downloading and prompt to restart."
              />
              <FeatureCard
                icon={Lock}
                title="Secure by default"
                description="Signed manifests, SHA-256 verification, HTTPS everywhere — and optional end-to-end encryption for your code."
              />
              <FeatureCard
                icon={Shield}
                title="App Store compliant"
                description="OTA updates for web layers only — fully compliant with Apple and Google guidelines for Capacitor apps."
              />
              <FeatureCard
                icon={Users}
                title="Team & API keys"
                description="Invite members, assign roles, and manage scoped API keys per organization."
              />
              <FeatureCard
                icon={Globe}
                title="Open source"
                description="Fully open-source core. Self-host on your own infrastructure or use our managed service."
              />
            </div>
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* Pricing */}
      <section id="pricing" className="relative border-x border-border mx-auto max-w-screen-xl">
        {copy.priceComparison && (
          <aside className="absolute -right-8 top-28 z-10 hidden w-fit max-w-sm rotate-2 rounded-xl border border-dashed border-yellow-300/80 bg-yellow-50 px-5 py-4 shadow-lg lg:block">
            <p className="text-xs font-medium uppercase tracking-widest text-yellow-800">
              OtaKit vs {copy.competitor}
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {copy.priceComparison.rows.map(([scenario, ours, theirs]) => (
                <li key={scenario} className="flex items-baseline justify-between gap-10">
                  <span className="text-yellow-900">{scenario}</span>
                  <span className="whitespace-nowrap font-medium tabular-nums text-yellow-950">
                    {ours} <span className="font-normal text-yellow-900/70">vs {theirs}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-yellow-900/80">
              These are just estimates —{' '}
              <Link
                href={copy.priceComparison.href}
                className="font-medium text-yellow-950 underline underline-offset-4"
              >
                see the full comparison →
              </Link>
            </p>
          </aside>
        )}
        <div className="">
          <div className="overflow-hidden">
            <div className="border-b border-border px-8 py-10 pt-30">
              <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
                Pricing
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                Simple, value-aligned pricing
              </h2>
              <p className="mt-4 max-w-3xl text-muted-foreground">
                Pricing is based on live updates delivered — no seat fees, end-user tracking,
                bandwidth, or storage.
              </p>
            </div>
            <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
              <PricingCard
                name="Free"
                price="$0"
                period="/mo"
                description="Free forever for early usage."
                allowance="5,000 updates / month"
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
                name="Starter"
                price="$10"
                period="/mo"
                description="Billed monthly. No annual plan."
                allowance="100,000 updates / month"
                features={[
                  'Everything in Free',
                  '20× the Free allowance',
                  'Single-member workspace',
                  'Hard cap — no overage',
                ]}
                cta="Start with Starter"
                highlighted
              />
              <PricingCard
                name="Pro"
                price="$25"
                period="/mo"
                description="Billed yearly ($300/yr) or $50 billed monthly."
                allowance="1,000,000 updates / month"
                features={[
                  'Everything in Free',
                  'Team members & roles',
                  'Usage-based overage ($50 / extra 1M)',
                  'Priority support',
                ]}
                cta="Start with Pro"
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
                copyEmail={site.supportEmail}
              />
            </div>
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
          <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">{copy.ctaTitle}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{copy.ctaSub}</p>
          <div className="mt-20 flex flex-col gap-4 sm:flex-row">
            <Link href={`${site.console}/login`}>
              <Button size="lg" className="group rounded-full px-8">
                <span className="shimmer">Get started free</span>
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

      {/* Stats */}
      <section className="border-x border-border mx-auto max-w-screen-xl">
        <div className="grid gap-px bg-border sm:grid-cols-3">
          {STATS.map((s) => (
            <div key={s.label} className="bg-background px-8 py-16 text-center">
              <div className="text-4xl font-bold tracking-tight sm:text-5xl">{s.value}</div>
              <div className="mt-3 text-sm text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <Separator className="" />

      {/* FAQ */}
      <section id="faq" className="border-x border-border mx-auto max-w-screen-xl">
        <div className="overflow-hidden">
          <div className="border-b border-border px-8 py-10 pt-30">
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
              FAQ
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Questions, answered
            </h2>
          </div>
          <div className="px-8 py-6">
            <Accordion type="single" collapsible className="w-full">
              {copy.faq.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`}>
                  <AccordionTrigger className="text-base font-semibold">{item.q}</AccordionTrigger>
                  <AccordionContent>
                    <div className="max-w-2xl space-y-3 text-[15px] leading-relaxed text-muted-foreground">
                      {item.a}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      <Separator className="" />

      {/* Footer */}
      <footer className="border-x border-t border-border mx-auto max-w-screen-xl">
        <div className="grid gap-10 px-8 py-14 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <Image
                src="/logo.svg"
                alt="OtaKit"
                width={24}
                height={24}
                className="size-6 rounded-md"
              />
              <span className="text-[15px] font-semibold tracking-tight text-foreground">
                OtaKit
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Instant over-the-air updates for Capacitor apps. Open source, CDN-delivered, and free
              to start.
            </p>
            <div className="mt-6 flex gap-5 text-sm text-muted-foreground">
              <a
                href={site.github}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                GitHub
              </a>
              <a
                href="https://otakit.hyperping.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground"
              >
                Status
              </a>
              <CopyEmailLink
                email={site.supportEmail}
                className="cursor-pointer transition-colors hover:text-foreground"
              >
                Contact
              </CopyEmailLink>
            </div>
          </div>

          <FooterColumn
            title="Product"
            links={[
              { label: 'Pricing', href: '#pricing' },
              { label: 'Dashboard', href: `${site.console}/dashboard` },
              { label: 'Sign up', href: `${site.console}/login` },
              { label: 'Security', href: '/docs/security' },
              { label: 'OtaKit vs Capgo', href: '/vs/capgo' },
              { label: 'OtaKit vs Capawesome', href: '/vs/capawesome' },
            ]}
          />

          <FooterColumn
            title="Docs"
            titleHref="/docs"
            links={[
              { label: 'Getting started', href: '/docs/setup' },
              { label: 'Channels & versions', href: '/docs/channels' },
              { label: 'Update strategies', href: '/docs/update-strategies' },
              { label: 'Self-hosting', href: '/docs/self-host' },
            ]}
          />

          <FooterColumn
            title="Blog"
            titleHref="/blog"
            links={[
              { label: 'How OTA updates work', href: '/blog/how-ota-works-for-capacitor-apps' },
              {
                label: 'App Store & Play rules',
                href: '/blog/ota-policies-for-app-store-and-google-play',
              },
              {
                label: 'OtaKit vs Capgo vs Capawesome',
                href: '/blog/best-live-update-frameworks-for-capacitor-apps',
              },
            ]}
          />
        </div>

        <div className="flex flex-col gap-4 border-t border-border px-8 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} OtaKit. Open source under MIT.</span>
          <div className="flex gap-6">
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

/* ─── Sub-components (same as homepage) ────────────────────────────── */

function FooterColumn({
  title,
  titleHref,
  links,
}: {
  title: string;
  titleHref?: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">
        {titleHref ? (
          <Link href={titleHref} className="transition-colors hover:text-muted-foreground">
            {title}
          </Link>
        ) : (
          title
        )}
      </h3>
      <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="transition-colors hover:text-foreground">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  href,
  copyEmail,
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
  copyEmail?: string;
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
        {copyEmail ? (
          <Button variant={highlighted ? 'default' : 'outline'} className="w-full" asChild>
            <CopyEmailLink email={copyEmail}>{cta}</CopyEmailLink>
          </Button>
        ) : (
          <Link href={href ?? `${site.console}/login`} className="block">
            <Button variant={highlighted ? 'default' : 'outline'} className="w-full">
              {cta}
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
