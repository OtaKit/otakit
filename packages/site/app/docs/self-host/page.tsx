import Link from 'next/link';

import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Self-hosting — OtaKit Docs',
  description: 'Run OtaKit on your own infrastructure.',
};

export default function SelfHostPage() {
  return (
    <>
      <H1>Self-hosting</H1>
      <P>
        OtaKit is fully open source and can run on your own infrastructure. The managed service at{' '}
        <Link
          href="/docs/setup"
          className="font-medium text-foreground underline underline-offset-4"
        >
          otakit.app
        </Link>{' '}
        runs everything for you — self-hosting is the advanced path.
      </P>

      <Separator className="my-10" />

      <H2>What you deploy</H2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <strong>Public site</strong> (<Code>packages/site</Code>) — landing page, docs, contact,
          and legal pages.
        </li>
        <li>
          <strong>Console</strong> (<Code>packages/console</Code>) — Next.js control plane: auth,
          dashboard UI, API routes, billing, and Prisma migrations.
        </li>
        <li>
          <strong>Ingest Worker</strong> (<Code>packages/ingest</Code>) — Cloudflare Worker that
          receives device events and writes them to Tinybird. Required if you want to use dashboard
          analytics.
        </li>
        <li>
          <strong>CDN bucket</strong> — public R2 or S3 bucket with a CDN domain. Serves manifest
          files and bundle zips directly to devices.
        </li>
      </ul>
      <P>
        The <strong>CLI</strong> (<Code>packages/cli</Code>) and{' '}
        <strong>Capacitor plugin</strong> (<Code>packages/capacitor-plugin</Code>) are client-side
        tools — they can be configured to point at your self-hosted services.
      </P>

      <Separator className="my-10" />

      <H2>Required services</H2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>PostgreSQL 14+</li>
        <li>S3-compatible object storage (Cloudflare R2, AWS S3)</li>
        <li>A public CDN domain in front of the storage bucket</li>
        <li>At least one provider (Google, Apple, Github, or Email OTP via Resend) for sign-in</li>
      </ul>

      <Separator className="my-10" />

      <H2>Environment variables</H2>

      <H3>Dashboard — required</H3>
      <Pre>{`DATABASE_URL=postgresql://user:pass@localhost:5432/otakit

BETTER_AUTH_SECRET=your-random-secret    # openssl rand -hex 32
BETTER_AUTH_URL=https://your-domain.com
# At least one provider for sign-in
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=....
RESEND_API_KEY=...
EMAIL_FROM=...

R2_BUCKET=...
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
R2_ENDPOINT=https://....r2.cloudflarestorage.com
CDN_BASE_URL=https://cdn.your-domain.com

# Cloudflare CDN purge — instant cache invalidation after releases.
# Without this, stale manifests may be served until CDN TTL expires.
CF_ZONE_ID=...
CF_API_TOKEN=...

# Tinybird — device event analytics and dashboard counts.
# Without this, the dashboard shows empty analytics and download counts return 0.
TINYBIRD_API_HOST=https://api.tinybird.co
TINYBIRD_READ_TOKEN=...

# Manifest signing — ES256 signatures on manifest JSON.
# Generate with: otakit generate-signing-key
MANIFEST_SIGNING_KID=key-2026-01
MANIFEST_SIGNING_KEY=-----BEGIN EC PRIVATE KEY-----...
# Set MANIFEST_SIGNING_DISABLED=true to skip signing entirely.`}</Pre>

      <H3>Ingest Worker</H3>
      <P>
        Only needed if you want to use analytics. See{' '}
        <Code>packages/ingest/wrangler.jsonc</Code> and{' '}
        <Code>packages/ingest/.env.example</Code> for the full config. The Worker needs a Tinybird
        append token and a Cloudflare Queue.
      </P>

      <Separator className="my-10" />

      <H2>Deploy</H2>

      <H3>Public site</H3>
      <Pre>{`git clone https://github.com/OtaKit/otakit
cd otakit
pnpm install

cd packages/site
pnpm build
pnpm start`}</Pre>

      <H3>Console</H3>
      <Pre>{`git clone https://github.com/OtaKit/otakit
cd otakit
pnpm install

cd packages/console
npx prisma migrate deploy
pnpm build
pnpm start`}</Pre>
      <P>
        Runs on port 3000. Put a reverse proxy (nginx, Caddy) in front with HTTPS.
      </P>

      <H3>Ingest Worker</H3>
      <Pre>{`cd packages/ingest
npx wrangler deploy`}</Pre>

      <H3>Tinybird project</H3>
      <Pre>{`cd tinybird
tb login
tb deploy`}</Pre>

      <Separator className="my-10" />

      <H2>Manifest signing</H2>
      <Pre>{`otakit generate-signing-key`}</Pre>
      <P>
        Add the private key to the dashboard env (<Code>MANIFEST_SIGNING_KID</Code>,{' '}
        <Code>MANIFEST_SIGNING_KEY</Code>). Add the public key to the Capacitor plugin config (
        <Code>manifestKeys</Code>).
      </P>

      <Separator className="my-10" />

      <H2>Configure the plugin</H2>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    cdnUrl: "https://cdn.your-domain.com",
    ingestUrl: "https://ingest.your-domain.com/v1",  // omit if not using Tinybird
    manifestKeys: [
      { kid: "key-2026-01", key: "MFkwEwYH..." }
    ]
  }
}`}</Pre>

      <Separator className="my-10" />

      <H2>Configure the CLI</H2>
      <Pre>{`export OTAKIT_SERVER_URL=https://your-domain.com/api/v1
export OTAKIT_TOKEN=otakit_sk_...`}</Pre>
      <P>
        Or set <Code>serverUrl</Code> in the Capacitor plugin config so the CLI can read it
        automatically.
      </P>
    </>
  );
}

function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="text-2xl font-bold tracking-tight">{children}</h1>;
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight">{children}</h2>;
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-sm font-semibold tracking-tight">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-muted-foreground">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border bg-muted px-4 py-3 font-mono text-xs leading-6 text-muted-foreground">
      {children}
    </pre>
  );
}
