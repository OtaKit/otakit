import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Security — OtaKit Docs',
  description: 'How OtaKit secures your OTA update delivery pipeline.',
};

export default function SecurityPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Security</h1>
      <P>
        OtaKit is designed so that a compromised CDN or network cannot push malicious code to your
        users. Every layer — from upload to delivery to activation — has a verification step.
      </P>

      <Separator className="my-10" />

      <H2>Manifest signing</H2>
      <P>
        Every manifest is signed with ES256 (ECDSA P-256) when a release is published. The
        plugin verifies the signature before trusting the manifest. A tampered manifest — whether
        modified in transit, at the CDN edge, or in storage — is rejected.
      </P>
      <P>
        The signing key stays on your server. The plugin only holds the public verification key.
        Self-hosters generate their own key pair with <Code>otakit generate-signing-key</Code>.
      </P>

      <Separator className="my-10" />

      <H2>Bundle verification</H2>
      <P>
        Every bundle download is verified against the SHA-256 hash in the signed manifest. If the
        hash does not match — due to corruption, tampering, or a partial download — the bundle is
        discarded and the update is not applied.
      </P>

      <Separator className="my-10" />

      <H2>Automatic rollback</H2>
      <P>
        After a new bundle is activated, the app must call <Code>notifyAppReady()</Code> within a
        configurable timeout (default 10 seconds). If the call does not arrive — because the new
        bundle crashes, hangs, or breaks — the plugin automatically rolls back to the last
        known-good bundle.
      </P>
      <P>
        This means a bad OTA release self-heals on the device without user intervention.
      </P>

      <Separator className="my-10" />

      <H2>Infrastructure</H2>
      <P>
        On the managed OtaKit service, manifests and bundles are served from Cloudflare&apos;s global
        CDN with 300+ edge locations. Download availability inherits Cloudflare&apos;s infrastructure
        SLA. Bundles are stored in Cloudflare R2 with encryption at rest.
      </P>
      <P>
        The dashboard and control plane run on isolated infrastructure. Device traffic (manifest
        fetches, bundle downloads) never touches the dashboard — it goes directly to the CDN.
      </P>

      <Separator className="my-10" />

      <H2>Data collection</H2>
      <P>
        OtaKit collects only device events (download, applied, rollback, error) for analytics and
        billing. Events include an app ID, platform, bundle version, and a random event ID. No
        persistent device identifiers, IP addresses, or personally identifiable information is
        stored.
      </P>
      <P>
        Self-hosters control the full data pipeline. The ingest service and analytics are optional
        and can be omitted entirely.
      </P>

      <Separator className="my-10" />

      <H2>Open source</H2>
      <P>
        The entire OtaKit codebase — plugin, CLI, dashboard, and ingest service — is open source
        under the MIT license. The signing and verification logic can be audited directly on{' '}
        <a
          href="https://github.com/OtaKit/otakit"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline underline-offset-4"
        >
          GitHub
        </a>
        .
      </P>
      <P>
        Self-hosting gives you full control over infrastructure, keys, and data. No vendor lock-in.
      </P>

      <Separator className="my-10" />

      <H2>HTTPS enforcement</H2>
      <P>
        The plugin enforces HTTPS for all manifest and bundle requests. HTTP is only allowed
        for <Code>localhost</Code> during development when explicitly opted in via{' '}
        <Code>allowInsecureUrls</Code>.
      </P>

      <Separator className="my-10" />

      <H2>API authentication</H2>
      <P>
        All dashboard and CLI operations require authentication via scoped API keys or session
        tokens. API keys are hashed before storage — the raw key is shown once at creation and
        never stored. Organization-level role-based access controls restrict who can upload
        bundles, create releases, or manage team members.
      </P>

      <Separator className="my-10" />

      <H2>Reporting a vulnerability</H2>
      <P>
        If you discover a security issue, please email{' '}
        <a
          href="mailto:security@otakit.app"
          className="font-medium text-foreground underline underline-offset-4"
        >
          security@otakit.app
        </a>
        . We aim to respond within 7 business days.
      </P>
    </>
  );
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
