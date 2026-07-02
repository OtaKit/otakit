import Link from 'next/link';

import { Separator } from '@/components/ui/separator';
import { Pre } from '@/app/docs/CodeBlock';

export const metadata = {
  title: 'Self-hosting',
  description: 'Run the full OtaKit platform on your own infrastructure, step by step.',
};

export default function SelfHostPage() {
  return (
    <>
      <H1>Self-hosting</H1>
      <P>
        OtaKit is MIT-licensed and fully open source — everything the hosted service runs is in the{' '}
        <A href="https://github.com/OtaKit/otakit">public repo</A>. The fastest way to ship OTA
        updates is the managed service at{' '}
        <Link
          href="/docs/setup"
          className="font-medium text-foreground underline underline-offset-4"
        >
          otakit.app
        </Link>{' '}
        (free tier, zero infrastructure). But if you need full control over delivery, keys, and
        data, this guide walks you through running your own instance end to end.
      </P>
      <P>
        There is no all-in-one Docker image yet. The control plane is a standard Next.js app, so it
        runs anywhere Node.js runs — a VPS behind nginx, your own container, or Vercel — plus a
        Postgres database and an S3-compatible bucket. That's the whole required stack.
      </P>

      <Separator className="my-10" />

      <H2>How it works</H2>
      <P>Three things to understand before you deploy anything:</P>
      <Ul>
        <li>
          <strong>The console publishes to storage.</strong> When you run{' '}
          <Code>otakit upload --release</Code>, the console API writes the bundle zip and a manifest
          JSON to your object storage bucket.
        </li>
        <li>
          <strong>Devices update from the CDN, not from your server.</strong> The Capacitor plugin
          fetches the manifest and bundle straight from the CDN domain in front of the bucket. Your
          console can be completely down and updates keep working.
        </li>
        <li>
          <strong>Everything else is optional.</strong> Analytics, email, billing, rate limiting,
          and CDN purge all degrade gracefully when their env vars are unset. You can start with
          the minimal stack and add pieces later.
        </li>
      </Ul>

      <Separator className="my-10" />

      <H2>What you need</H2>

      <H3>Required</H3>
      <Ul>
        <li>
          <strong>Console</strong> (<Code>packages/console</Code>) — the Next.js control plane:
          dashboard, auth, API, and manifest publishing. This is the only server you must run.
        </li>
        <li>
          <strong>PostgreSQL 14+</strong> — apps, bundles, releases, users.
        </li>
        <li>
          <strong>S3-compatible object storage</strong> — Cloudflare R2 or AWS S3, for bundle zips
          and manifests.
        </li>
        <li>
          <strong>A public CDN domain</strong> in front of the bucket — devices download manifests
          and bundles from here.
        </li>
        <li>
          <strong>One sign-in method</strong> — Google, Apple, or GitHub OAuth credentials, or
          email OTP (needs Resend in production).
        </li>
      </Ul>

      <H3>Optional</H3>
      <Ul>
        <li>
          <strong>Ingest Worker + Tinybird</strong> (<Code>packages/ingest</Code>,{' '}
          <Code>tinybird/</Code>) — device event analytics. Without it, updates work fine; the
          dashboard just shows empty analytics.
        </li>
        <li>
          <strong>Manifest signing</strong> — ES256 signatures on manifests. Strongly recommended
          for production; see below.
        </li>
        <li>
          <strong>Resend</strong> — transactional email (OTP codes, invites). Without it, emails
          are logged to the server console.
        </li>
        <li>
          <strong>Cloudflare cache purge</strong> — instant CDN invalidation after a release.
          Without it, manifests may be stale until the CDN TTL (minutes) expires.
        </li>
        <li>
          <strong>Upstash Redis</strong> — API rate limiting. Without it, rate limiting is
          disabled.
        </li>
        <li>
          <strong>Polar</strong> — billing. Leave it unset when self-hosting: all organizations get
          unlimited usage and the billing UI is hidden.
        </li>
        <li>
          <strong>Public site</strong> (<Code>packages/site</Code>) — the marketing site and docs
          you're reading now. You don't need it.
        </li>
      </Ul>
      <P>
        The <strong>CLI</strong> (<Code>packages/cli</Code>) and <strong>Capacitor plugin</strong>{' '}
        (<Code>packages/capacitor-plugin</Code>) run on your machine and inside your app — you
        point them at your instance in steps 6 and 7.
      </P>

      <Separator className="my-10" />

      <H2>Step 1 — Clone and install</H2>
      <P>You need Node.js 20.9+ and pnpm 9+.</P>
      <Pre>{`git clone https://github.com/OtaKit/otakit
cd otakit
pnpm install`}</Pre>

      <H2 className="mt-10">Step 2 — Create the database</H2>
      <P>
        Any PostgreSQL 14+ works — a managed database (Neon, RDS, Supabase) or your own server.
        Note the connection string; you'll set it as <Code>DATABASE_URL</Code> in step 4.
      </P>

      <H2 className="mt-10">Step 3 — Create the storage bucket and CDN</H2>
      <P>
        Create a bucket on Cloudflare R2 or AWS S3 and put a public CDN domain in front of it
        (e.g. R2 custom domain, or CloudFront for S3). Generate S3 API credentials with read/write
        access to the bucket. The public domain becomes <Code>CDN_BASE_URL</Code> — devices will
        fetch manifests and bundles from it, so it must be publicly readable.
      </P>

      <H2 className="mt-10">Step 4 — Configure the console</H2>
      <P>
        Copy <Code>packages/console/.env.example</Code> to <Code>.env</Code>. It is annotated with
        the same required/optional split as this page. The required variables:
      </P>
      <Pre>{`# Database
DATABASE_URL=postgresql://user:pass@host:5432/otakit

# API write secret for admin/CLI endpoints
SECRET_KEY=change-me                     # openssl rand -hex 32

# Auth + public URLs
BETTER_AUTH_SECRET=change-me             # openssl rand -hex 32
BETTER_AUTH_URL=https://console.your-domain.com
NEXT_PUBLIC_APP_URL=https://console.your-domain.com
NEXT_PUBLIC_SITE_URL=https://console.your-domain.com

# At least one sign-in provider
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
# or APPLE_CLIENT_ID / APPLE_CLIENT_SECRET
# or GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET

# Object storage (R2 shown; any S3-compatible API works)
R2_BUCKET=otakit-bundles
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com

# Public CDN domain in front of the bucket
CDN_BASE_URL=https://cdn.your-domain.com`}</Pre>
      <P>
        Everything else in <Code>.env.example</Code> (Tinybird, Resend, Polar, Cloudflare purge,
        Upstash, signing) is optional and covered at the end of this page.
      </P>

      <H2 className="mt-10">Step 5 — Migrate, build, start</H2>
      <Pre>{`cd packages/console
npx prisma migrate deploy
pnpm build
pnpm start`}</Pre>
      <P>
        The console listens on port 3000. Put a reverse proxy (nginx, Caddy) in front with HTTPS —
        or deploy it like any other Next.js app, to Vercel or your own container platform.
      </P>

      <H2 className="mt-10">Step 6 — Sign in and create your app</H2>
      <P>
        Open your console URL, sign in, and create an app. Copy its <Code>appId</Code> and create
        an API token (<Code>otakit_sk_...</Code>) for the CLI.
      </P>

      <H2 className="mt-10">Step 7 — Point the CLI at your instance</H2>
      <Pre>{`export OTAKIT_SERVER_URL=https://console.your-domain.com
export OTAKIT_TOKEN=otakit_sk_...`}</Pre>
      <P>
        Alternatively set <Code>serverUrl</Code> in the plugin config (next step) — the CLI reads
        it from <Code>capacitor.config.*</Code> automatically — and authenticate with{' '}
        <Code>otakit login</Code> instead of an env token.
      </P>

      <H2 className="mt-10">Step 8 — Configure the plugin</H2>
      <P>
        In your app's <Code>capacitor.config.ts</Code>:
      </P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_APP_ID",
    cdnUrl: "https://cdn.your-domain.com",          // required: your CDN domain
    serverUrl: "https://console.your-domain.com",   // optional: lets the CLI find your console
    ingestUrl: "https://ingest.your-domain.com/v1", // optional: only with analytics (below)
    manifestKeys: [                                  // optional: only with signing (below)
      { kid: "key-2026-01", key: "MFkwEwYH..." }
    ]
  }
}`}</Pre>

      <H2 className="mt-10">Step 9 — Ship a release and verify</H2>
      <Pre>{`# build your web assets, then:
otakit upload --release`}</Pre>
      <P>
        Confirm the release appears in your dashboard, and that the manifest is publicly readable
        at <Code>{'{CDN_BASE_URL}/manifests/{appId}/__base__/__default__/manifest.json'}</Code>.
        Then launch your app: on start or resume the plugin fetches that manifest, downloads the
        new bundle, and applies it. Your self-hosted pipeline is live.
      </P>

      <Separator className="my-10" />

      <H2>Optional: manifest signing (recommended)</H2>
      <P>
        Signing lets devices verify manifests were produced by your server, not just served from
        your CDN. Generate a key pair:
      </P>
      <Pre>{`otakit generate-signing-key`}</Pre>
      <P>
        Put the private key in the console env (<Code>MANIFEST_SIGNING_KID</Code>,{' '}
        <Code>MANIFEST_SIGNING_KEY</Code>) and the public key in the plugin config's{' '}
        <Code>manifestKeys</Code>. To run without signing, set{' '}
        <Code>MANIFEST_SIGNING_DISABLED=true</Code>.
      </P>

      <H2 className="mt-10">Optional: analytics (Ingest Worker + Tinybird)</H2>
      <P>
        Device events (downloaded, applied, rolled back) flow from the plugin to a Cloudflare
        Worker, which batches them into Tinybird. The dashboard reads its charts and download
        counts from Tinybird pipes.
      </P>
      <Pre>{`# 1. Deploy the Tinybird project (datasources + pipes)
cd tinybird
tb login
tb deploy

# 2. Deploy the Worker
cd packages/ingest
npx wrangler secret put TINYBIRD_EVENTS_TOKEN   # Tinybird append token
npx wrangler deploy`}</Pre>
      <P>
        See <Code>packages/ingest/README.md</Code> for the Worker's queue and rate-limit bindings
        in <Code>wrangler.jsonc</Code>. Then set <Code>TINYBIRD_API_HOST</Code> and{' '}
        <Code>TINYBIRD_READ_TOKEN</Code> in the console env, and <Code>ingestUrl</Code> in the
        plugin config.
      </P>

      <H2 className="mt-10">Optional: everything else</H2>
      <Ul>
        <li>
          <strong>Email</strong> — set <Code>RESEND_API_KEY</Code> and <Code>EMAIL_FROM</Code> to
          send OTP codes and invites via Resend.
        </li>
        <li>
          <strong>CDN purge</strong> — set <Code>CF_ZONE_ID</Code> and <Code>CF_API_TOKEN</Code>{' '}
          (Cloudflare) so releases invalidate cached manifests instantly.
        </li>
        <li>
          <strong>Rate limiting</strong> — set <Code>UPSTASH_REDIS_REST_URL</Code> and{' '}
          <Code>UPSTASH_REDIS_REST_TOKEN</Code> to rate-limit the API.
        </li>
        <li>
          <strong>Billing</strong> — Polar integration powers the hosted service's plans. Leave the{' '}
          <Code>POLAR_*</Code> vars unset for unlimited usage with no billing UI.
        </li>
      </Ul>
      <P>
        Stuck on something? <A href="mailto:support@otakit.app">Email us</A> or open an issue on{' '}
        <A href="https://github.com/OtaKit/otakit">GitHub</A> — self-hosting reports help us make
        this guide better.
      </P>
    </>
  );
}

function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="text-2xl font-bold tracking-tight">{children}</h1>;
}

function H2({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`text-lg font-semibold tracking-tight ${className ?? ''}`}>{children}</h2>;
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-sm font-semibold tracking-tight">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-muted-foreground">{children}</p>;
}

function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">{children}</ul>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="font-medium text-foreground underline underline-offset-4"
      target={href.startsWith('http') ? '_blank' : undefined}
      rel={href.startsWith('http') ? 'noreferrer' : undefined}
    >
      {children}
    </a>
  );
}
