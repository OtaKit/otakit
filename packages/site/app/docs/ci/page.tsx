import Link from 'next/link';
import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'CI Automation — OtaKit Docs',
  description: 'Use GitHub Actions to build, upload, and optionally release OtaKit bundles.',
};

export default function CiAutomationPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">CI automation with GitHub Actions</h1>
      <P>
        This workflow builds your app, uploads a bundle, and can either leave it uploaded, release
        it to the base channel, or release it to a named channel.
      </P>

      <Separator className="my-10" />

      <H2>1. Add repository secrets and variables</H2>
      <P>GitHub repository secrets:</P>
      <Pre>{`OTAKIT_TOKEN=otakit_sk_...
OTAKIT_APP_ID=app_...`}</Pre>
      <P>Optional GitHub repository variables:</P>
      <Pre>{`OTAKIT_RELEASE_CHANNEL=base

# Leave empty or unset for upload-only.
# Use "base" for the base channel.
# Use a channel name like "staging" for a named release track.`}</Pre>

      <Separator className="my-10" />

      <H2>2. Copy this workflow</H2>
      <P>
        Create <Code>.github/workflows/otakit.yml</Code>:
      </P>
      <Pre>{`name: OTA upload

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  upload:
    runs-on: ubuntu-latest
    env:
      OTAKIT_TOKEN: \${{ secrets.OTAKIT_TOKEN }}
      OTAKIT_APP_ID: \${{ secrets.OTAKIT_APP_ID }}
      OTAKIT_RELEASE_CHANNEL: \${{ vars.OTAKIT_RELEASE_CHANNEL }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci
      - run: npm run build

      - name: Upload bundle
        run: |
          if [ -z "$OTAKIT_RELEASE_CHANNEL" ]; then
            npx --yes @otakit/cli@latest upload
          elif [ "$OTAKIT_RELEASE_CHANNEL" = "base" ]; then
            npx --yes @otakit/cli@latest upload --release
          else
            npx --yes @otakit/cli@latest upload --release "$OTAKIT_RELEASE_CHANNEL"
          fi`}</Pre>
      <P>
        This workflow uses the default bundle path from <Code>capacitor.config.ts</Code>.
      </P>

      <Separator className="my-10" />

      <H2>Release channel options</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Empty or unset <Code>OTAKIT_RELEASE_CHANNEL</Code>: upload only
        </li>
        <li>
          <Code>OTAKIT_RELEASE_CHANNEL=base</Code>: upload and release to the base channel
        </li>
        <li>
          <Code>OTAKIT_RELEASE_CHANNEL=staging</Code>: upload and release to the{' '}
          <Code>staging</Code> channel
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Self-hosted addition</H2>
      <P>
        If you run your own OtaKit server, add this environment variable to the workflow as well:
      </P>
      <Pre>{`OTAKIT_SERVER_URL: \${{ secrets.OTAKIT_SERVER_URL }}`}</Pre>

      <Separator className="my-10" />

      <H2>Best practices</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Pin the CLI version after your first successful run instead of using <Code>@latest</Code>{' '}
          forever.
        </li>
        <li>
          Use the base channel for the simplest production setup. Add a named channel only when you
          need a separate rollout track such as <Code>staging</Code>.
        </li>
        <li>Use branch protection so OTA uploads only run from trusted branches.</li>
      </ul>

      <Separator className="my-10" />

      <H2>Next</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Use the{' '}
          <Link href="/docs/cli" className="font-medium text-foreground underline underline-offset-4">
            CLI reference
          </Link>{' '}
          for exact upload, login, and token commands.
        </li>
      </ul>
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

function Pre({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border bg-muted px-4 py-3 font-mono text-xs leading-6 text-muted-foreground">
      {children}
    </pre>
  );
}
