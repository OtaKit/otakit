import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support';

export const metadata = {
  title: 'OtaKit — Docs',
  description: 'How OtaKit works and where to start.',
};

export default function DocsOverviewPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Introduction</h1>
      <p className="mt-3 text-muted-foreground">
        OtaKit ships over-the-air updates for Capacitor apps. You build your web app, upload a
        bundle, and the plugin delivers that bundle to devices without waiting for a store review.
      </p>

      <div className="mt-6">
        <Link href="/docs/setup">
          <Button>
            Start with setup
            <ArrowRight className="size-3.5" />
          </Button>
        </Link>
      </div>

      <Separator className="my-10" />

      <H2>How it works</H2>
      <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
        <li>
          Create an app in the OtaKit dashboard and copy its <Code>appId</Code> into your{' '}
          <Code>capacitor.config.ts</Code> file.
        </li>
        <li>
          Call <Code>notifyAppReady()</Code> when your app finishes loading, so newly activated
          updates can be confirmed healthy.
        </li>
        <li>
          Build your web app and run <Code>otakit upload --release</Code> to upload and publish a
          new bundle.
        </li>
        <li>
          On device, the plugin checks for updates, verifies the downloaded bundle, and by default
          activates it on the next cold launch by default.
        </li>
      </ol>

      <Separator className="my-10" />

      <H2>Features</H2>
      <div className="-mx-6 mt-4 grid w-[calc(100%+3rem)] gap-px overflow-hidden border-t border-border bg-border sm:grid-cols-2">
        <Feature
          title="One-command shipping"
          description="Build your web app, then release with otakit upload --release."
        />
        <Feature
          title="Channels & runtime lanes"
          description="Use channels for rollout tracks and runtimeVersion for native compatibility boundaries."
        />
        <Feature
          title="Automatic update delivery"
          description="The normal flow checks and downloads automatically, then activates based on updateMode."
        />
        <Feature
          title="Manual update control"
          description="Switch to manual mode when your app wants to show its own update prompt or control install timing."
        />
        <Feature
          title="Safe activation & rollback"
          description="A newly activated bundle must call notifyAppReady() or OtaKit rolls back automatically."
        />
        <Feature
          title="SHA-256 verification"
          description="Downloaded bundles are verified before activation so corrupted or tampered files are rejected."
        />
        <Feature
          title="Organization access & API keys"
          description="Manage apps, members, and scoped keys inside an organization."
        />
        <Feature
          title="Self-hosting"
          description="Run OtaKit on your own infrastructure when you need full control over delivery and trust."
        />
      </div>

      <Separator className="mb-10" />

      <H2>Getting started</H2>

      <div className="-mx-6 mt-4 -mb-10 grid w-[calc(100%+3rem)] gap-px overflow-hidden border-t border-border bg-border sm:grid-cols-2">
        <NavCard
          href="/docs/setup"
          title="Setup"
          description="Connect the default hosted OtaKit flow to your Capacitor app."
        />
        <NavCard
          href="/docs/guide"
          title="Next.js Guide"
          description="Go from Next.js + Capacitor to your first OTA update."
        />
        <NavCard
          href="/docs/channels"
          title="Channels"
          description="Rollout tracks vs runtime compatibility lanes, and when to use each."
        />
        <NavCard
          href="/docs/ci"
          title="CI Automation"
          description="Build and ship bundles from GitHub Actions."
        />
        <NavCard
          href="/docs/cli"
          title="CLI Reference"
          description="Commands, options, and release workflows."
        />
        <NavCard
          href="/docs/plugin"
          title="Plugin API"
          description="Default automatic flow, manual flow, events, and configuration."
        />
      </div>

      <Separator className="my-10" />
      <p className="text-sm text-muted-foreground">
        Need help with setup, billing, or rollout issues? Email{' '}
        <a href={SUPPORT_MAILTO} className="underline underline-offset-4 hover:text-foreground">
          {SUPPORT_EMAIL}
        </a>{' '}
        or use the{' '}
        <Link href="/contact" className="underline underline-offset-4 hover:text-foreground">
          contact page
        </Link>
        .
      </p>
    </>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight">{children}</h2>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
}

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-background p-5 transition-colors hover:bg-muted/30">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function NavCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className="group bg-background p-5 transition-colors hover:bg-muted/30">
      <h3 className="text-sm font-medium group-hover:underline">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
