import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Info, Rss, TriangleAlert } from 'lucide-react';

import { Pre } from '@/app/docs/CodeBlock';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { CopyEmailLink } from '@/components/CopyEmailLink';
import { BlurRevealObserver } from '@/components/landing/BlurRevealObserver';
import {
  changelogEntries,
  changelogPackages,
  formatChangelogDate,
  splitInlineCode,
  TYPE_LABELS,
  versionLabels,
  type ChangelogEntry,
  type ChangelogType,
} from '@/lib/changelog';
import { site } from '@/lib/site';

// Same skeleton as the homepage (app/page.tsx) and the /push landing page.

const DESCRIPTION =
  'New features, improvements and fixes in OtaKit: the Capacitor live update plugin, the CLI, the dashboard and the API.';

export const metadata: Metadata = {
  title: 'Changelog',
  description: DESCRIPTION,
  alternates: {
    canonical: `${site.url}/changelog`,
    types: { 'application/rss+xml': `${site.url}/changelog/rss.xml` },
  },
  openGraph: {
    title: 'OtaKit Changelog',
    description: DESCRIPTION,
    url: `${site.url}/changelog`,
    siteName: site.name,
    type: 'website',
  },
};

const TYPE_STYLES: Record<ChangelogType, string> = {
  launch: 'border-violet-500/25 bg-violet-500/[0.08] text-violet-700',
  feature: 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-700',
  improvement: 'border-sky-500/25 bg-sky-500/[0.08] text-sky-700',
  fix: 'border-amber-500/30 bg-amber-500/[0.08] text-amber-700',
};

export default function ChangelogPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground m-3 border border-border">
      <BlurRevealObserver />
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
              href="/#pricing"
              className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
            >
              Pricing
            </Link>
            <Link
              href="/docs"
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
              <Link href={`${site.console}/dashboard`} className="hidden sm:block">
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
      <section className="relative mx-auto max-w-screen-xl overflow-hidden border-x border-border pb-16 pt-28 sm:pb-24 sm:pt-36">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--color-border)_1.5px,transparent_1.5px)] bg-[size:28px_28px] opacity-60"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent"
          aria-hidden="true"
        />

        <div className="relative px-8 sm:px-10">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Changelog
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            What&apos;s new in OtaKit
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            New features, improvements and fixes across the Capacitor plugin, the CLI, the dashboard
            and the API.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <a href="/changelog/rss.xml">
              <Button variant="outline" size="lg" className="rounded-full px-6">
                <Rss className="size-4" />
                RSS feed
              </Button>
            </a>
            <a href={site.github} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="lg" className="rounded-full px-6">
                Source on GitHub
                <ArrowUpRight className="size-4" />
              </Button>
            </a>
          </div>
        </div>
      </section>

      <Separator />

      {/* Latest versions */}
      <section className="mx-auto max-w-screen-xl border-x border-border">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-px bg-border md:grid-cols-3">
          {changelogPackages.map((pkg) => (
            <div key={pkg.key} className="bg-background p-8 sm:p-10">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  {pkg.label}
                </p>
                <a
                  href={`https://www.npmjs.com/package/${pkg.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  npm
                  <ArrowUpRight className="size-3" />
                </a>
              </div>
              <p className="mt-3 font-mono text-3xl font-semibold tracking-tight">{pkg.version}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Released {formatChangelogDate(pkg.date, 'long')}
              </p>
              <Pre>{pkg.install}</Pre>
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* Entries */}
      <section className="mx-auto max-w-screen-xl border-x border-border">
        <div
          className="border-b border-border px-8 pb-10 pt-20 sm:px-10 sm:pb-14 sm:pt-28"
          data-blur-reveal
        >
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Releases
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Every change, newest first
          </h2>
          <p className="mt-4 max-w-xl text-muted-foreground">
            Plugin features need the plugin version shown and, where noted, a native build. Server
            and dashboard changes are live for everyone as soon as they ship.
          </p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-px bg-border">
          {changelogEntries.map((entry) => (
            <EntryRow key={entry.slug} entry={entry} />
          ))}
        </div>
      </section>

      <Separator />

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
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Need a Mac for iOS builds?{' '}
              <a
                href="https://nomac.app/?utm_source=otakit&utm_medium=footer&utm_campaign=friends"
                target="_blank"
                rel="noopener"
                className="text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground"
              >
                Try NoMac
              </a>
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
              { label: 'Pricing', href: '/#pricing' },
              { label: 'Push notifications', href: '/push' },
              { label: 'Changelog', href: '/changelog' },
              { label: 'Dashboard', href: `${site.console}/dashboard` },
              { label: 'Sign up', href: `${site.console}/login` },
              { label: 'Security', href: '/docs/security' },
            ]}
          />

          <FooterColumn
            title="Docs"
            titleHref="/docs"
            links={[
              { label: 'Getting started', href: '/docs/setup' },
              { label: 'CLI reference', href: '/docs/cli' },
              { label: 'Plugin API', href: '/docs/plugin' },
              { label: 'MCP & Agent Skills', href: '/docs/agents' },
            ]}
          />

          <FooterColumn
            title="Blog"
            titleHref="/blog"
            links={[
              {
                label: 'Ship updates with AI agents',
                href: '/blog/ship-capacitor-updates-with-ai-agents',
              },
              { label: 'How OTA updates work', href: '/blog/how-ota-works-for-capacitor-apps' },
              {
                label: 'App Store & Play rules',
                href: '/blog/ota-policies-for-app-store-and-google-play',
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

/* ─── Sub-components ───────────────────────────────────────────────── */

function EntryRow({ entry }: { entry: ChangelogEntry }) {
  const versions = versionLabels(entry);
  return (
    <article
      id={entry.slug}
      className="grid scroll-mt-20 grid-cols-[minmax(0,1fr)] bg-background lg:grid-cols-[15rem_minmax(0,1fr)]"
    >
      <div className="px-8 pt-8 sm:px-10 lg:border-r lg:border-border lg:py-12">
        <div className="lg:sticky lg:top-24">
          <time dateTime={entry.date} className="text-sm font-medium text-foreground">
            {formatChangelogDate(entry.date, 'long')}
          </time>
          {versions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {versions.map((label) => (
                <span
                  key={label}
                  className="rounded-md border border-border bg-muted/50 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="px-8 pb-10 pt-5 sm:px-10 lg:py-12">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TYPE_STYLES[entry.type]}`}
            >
              {TYPE_LABELS[entry.type]}
            </span>
            <span className="text-xs text-muted-foreground">{entry.areas.join(' · ')}</span>
          </div>

          <h3 className="mt-4 text-2xl font-bold tracking-tight">
            <a href={`#${entry.slug}`} className="group">
              {entry.title}
              <span
                className="ml-2 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/50"
                aria-hidden="true"
              >
                #
              </span>
            </a>
          </h3>

          <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
            <Inline text={entry.summary} />
          </p>

          {entry.highlights?.length ? (
            <ul className="mt-5 space-y-2.5 text-[15px] leading-7 text-muted-foreground">
              {entry.highlights.map((item) => (
                <li key={item} className="flex gap-3">
                  <span
                    className="mt-[0.7rem] size-1.5 shrink-0 rounded-full bg-foreground/30"
                    aria-hidden="true"
                  />
                  <span>
                    <Inline text={item} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {entry.code ? <Pre>{entry.code}</Pre> : null}

          {entry.requires ? (
            <p className="mt-5 flex gap-2.5 text-sm leading-6 text-muted-foreground">
              <Info className="mt-[0.2rem] size-4 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-medium text-foreground">Requires: </span>
                <Inline text={entry.requires} />
              </span>
            </p>
          ) : null}

          {entry.upgrade?.length ? (
            <div className="mt-6 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-5">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-800">
                <TriangleAlert className="size-4" aria-hidden="true" />
                Upgrade notes
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                {entry.upgrade.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span
                      className="mt-[0.6rem] size-1 shrink-0 rounded-full bg-amber-700/50"
                      aria-hidden="true"
                    />
                    <span>
                      <Inline text={item} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {entry.links?.length ? (
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {entry.links.map((link) =>
                link.href.startsWith('/') ? (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="group inline-flex items-center gap-1 font-medium text-foreground"
                  >
                    {link.label}
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ) : (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-foreground hover:underline underline-offset-4"
                  >
                    {link.label}
                    <ArrowUpRight className="size-3.5" />
                  </a>
                ),
              )}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {splitInlineCode(text).map((part, index) =>
        part.code ? (
          <code
            key={index}
            className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground"
          >
            {part.text}
          </code>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

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
