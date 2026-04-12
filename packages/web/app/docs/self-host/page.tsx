import Link from 'next/link';

import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Self-hosting (Advanced) — OtaKit Docs',
  description: 'Run OtaKit on your own infrastructure.',
};

export default function SelfHostPage() {
  return (
    <>
      <H1>Self-hosting (Advanced)</H1>
      <P>
        OtaKit is fully open source and can run on your own infrastructure. You&apos;ll need
        PostgreSQL and any S3-compatible object storage (AWS S3, Cloudflare R2, MinIO).
      </P>
      <P>
        In the self-hosted architecture, manifests and bundle zips are served directly from object
        storage through your CDN. The plugin fetches the manifest for its lane and decides locally
        whether it should download anything newer.
      </P>
      <P>
        If you want the managed OtaKit service, use the standard hosted{' '}
        <Link
          href="/docs/setup"
          className="font-medium text-foreground underline underline-offset-4"
        >
          setup guide
        </Link>{' '}
        instead.
      </P>

      <Separator className="my-10" />

      <H2>Requirements</H2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>Node.js 23+</li>
        <li>PostgreSQL 14+</li>
        <li>S3-compatible storage (R2, MinIO, AWS S3)</li>
        <li>A public CDN in front of your bundle and manifest bucket</li>
      </ul>

      <Separator className="my-10" />

      <H2>Environment variables</H2>
      <Pre>{`# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/otakit

# Auth
BETTER_AUTH_SECRET=your-random-secret    # openssl rand -hex 32
BETTER_AUTH_URL=https://your-domain.com

# S3-compatible storage
R2_BUCKET=otakit-bundles
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
R2_ENDPOINT=https://....r2.cloudflarestorage.com
CDN_BASE_URL=https://cdn.your-domain.com

# Optional: Cloudflare purge support for manifest changes
CF_ZONE_ID=...
CF_API_TOKEN=...

# Optional: upload size limit (bytes, default 200MB)
MAX_BUNDLE_SIZE=209715200

# Manifest signing is enabled by default
# Generate with: otakit generate-signing-key
MANIFEST_SIGNING_KID=key-2026-01
MANIFEST_SIGNING_KEY=-----BEGIN EC PRIVATE KEY-----...

# Only set this if you intentionally want unsigned manifests
# MANIFEST_SIGNING_DISABLED=true

# Optional: global admin key for organization management
ADMIN_SECRET_KEY=your-admin-key`}</Pre>

      <Separator className="my-10" />

      <H2>Deploy</H2>
      <Pre>{`git clone https://github.com/nicepkg/otakit
cd otakit

# Install dependencies
pnpm install

# Run database migrations
cd packages/web
npx prisma migrate deploy

# Build and start
pnpm build
pnpm start`}</Pre>
      <P>
        The server runs on port 3000 by default. Point your reverse proxy (nginx, Caddy) to it and
        ensure HTTPS is configured.
      </P>
      <Separator className="my-10" />

      <H2>Docker</H2>
      <Pre>{`docker run -d \\
  -p 3000:3000 \\
  -e DATABASE_URL=postgresql://... \\
  -e BETTER_AUTH_SECRET=... \\
  -e BETTER_AUTH_URL=https://your-domain.com \\
  -e R2_BUCKET=otakit-bundles \\
  -e R2_ACCESS_KEY=... \\
  -e R2_SECRET_KEY=... \\
  -e R2_ENDPOINT=https://... \\
  ghcr.io/nicepkg/otakit:latest`}</Pre>

      <Separator className="my-10" />

      <H2>Initial setup</H2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Open your domain in a browser and sign in — the first user account is created
          automatically via email OTP.
        </li>
        <li>Create an organization from the Account tab.</li>
        <li>Generate an API key from the Organization tab — you&apos;ll need this for the CLI.</li>
        <li>Point the CLI to your server:</li>
      </ol>
      <Pre>{`export OTAKIT_SERVER_URL=https://your-domain.com/api/v1
export OTAKIT_SECRET_KEY=otakit_sk_...`}</Pre>

      <Separator className="my-10" />

      <H2>Manifest signing</H2>
      <P>
        Manifest signing is enabled by default. For a normal self-hosted setup, generate an ES256
        key pair and set these on the server:
      </P>
      <Pre>{`otakit generate-signing-key`}</Pre>
      <P>
        This outputs the server environment variables (<Code>MANIFEST_SIGNING_KID</Code>,{' '}
        <Code>MANIFEST_SIGNING_KEY</Code>) and the plugin config (<Code>manifestKeys</Code>). Add
        them to your server and Capacitor config respectively.
      </P>
      <Pre>{`plugins: {
  OtaKit: {
    cdnUrl: "https://cdn.your-domain.com",
    serverUrl: "https://your-domain.com/api/v1",
    appId: "YOUR_OTAKIT_APP_ID",
    manifestKeys: [
      { kid: "key-2026-01", key: "MFkwEwYH..." }
    ]
  }
}`}</Pre>
      <P>
        Keep the private signing key on the server only. The plugin should only receive the public
        verification keys in <Code>manifestKeys</Code>.
      </P>
      <P>
        If you intentionally want unsigned manifests on a custom server, set{' '}
        <Code>MANIFEST_SIGNING_DISABLED=true</Code>. When signing is not disabled, missing signing
        env vars are treated as a server misconfiguration and manifest requests will fail.
      </P>

      <Separator className="my-10" />

      <H2>Connecting CLI and plugin</H2>
      <P>
        Point the CLI to your server with <Code>OTAKIT_SERVER_URL</Code>:
      </P>
      <Pre>{`export OTAKIT_SERVER_URL=https://your-domain.com/api/v1
export OTAKIT_SECRET_KEY=otakit_sk_...`}</Pre>
      <P>
        In your Capacitor plugin config, set <Code>cdnUrl</Code> to your manifest CDN and{' '}
        <Code>serverUrl</Code> to your API server:
      </P>
      <Pre>{`plugins: {
  OtaKit: {
    cdnUrl: "https://cdn.your-domain.com",
    serverUrl: "https://your-domain.com/api/v1",
    appId: "YOUR_OTAKIT_APP_ID",
    // manifestKeys: [{ kid, key }]
  }
}`}</Pre>
      <P>
        The hosted defaults are <Code>https://cdn.otakit.app</Code> for manifests/bundles and{' '}
        <Code>https://www.otakit.app/api/v1</Code> for stats. Follow the standard{' '}
        <Link
          href="/docs/setup"
          className="font-medium text-foreground underline underline-offset-4"
        >
          setup guide
        </Link>{' '}
        for the rest of the plugin and CLI configuration.
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
