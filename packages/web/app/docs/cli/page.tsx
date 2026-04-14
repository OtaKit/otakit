import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'CLI Reference — OtaKit Docs',
  description:
    'Upload bundles, release them, inspect history, and manage apps with the OtaKit CLI.',
};

export default function CliReferencePage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">CLI Reference</h1>
      <P>
        Use the CLI to upload bundles, release them, inspect bundle and release history, and manage
        apps.
      </P>

      <Separator className="my-10" />

      <H2>Project config</H2>
      <P>
        Project commands read from <Code>capacitor.config.*</Code>.
      </P>
      <Pre>{`// capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "out",
  plugins: {
    OtaKit: {
      appId: "app_xxxxxxxx",
      // Optional named channel:
      // channel: "staging"
      // Optional compatibility lane:
      // runtimeVersion: "2026.04"
    }
  }
};

export default config;`}</Pre>

      <Separator className="my-10" />

      <H2>Authentication</H2>
      <P>
        For local development, sign in once and the CLI stores a token locally. For CI or
        non-interactive environments, use an organization secret key instead.
      </P>
      <Pre>{`# Local development
otakit login

# CI / non-interactive
export OTAKIT_TOKEN=otakit_sk_...
export OTAKIT_APP_ID=app_xxxxxxxx`}</Pre>

      <Separator className="my-10" />

      <H2>Release flow</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Upload only: <Code>otakit upload</Code>
        </li>
        <li>
          Upload and release to the base channel: <Code>otakit upload --release</Code>
        </li>
        <li>
          Upload and release to a named channel: <Code>otakit upload --release beta</Code>
        </li>
        <li>
          Promote an existing bundle later:{' '}
          <Code>otakit release &lt;bundleId&gt; --channel production</Code>
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Resolution order</H2>
      <P>The CLI resolves values in a deterministic order.</P>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          App ID: <Code>--app-id</Code> {'->'} <Code>OTAKIT_APP_ID</Code> {'->'}{' '}
          <Code>capacitor.config.*</Code>
        </li>
        <li>
          Server URL: <Code>--server</Code> {'->'} <Code>OTAKIT_SERVER_URL</Code> {'->'}{' '}
          <Code>plugins.OtaKit.serverUrl</Code> {'->'} hosted default
        </li>
        <li>
          Auth token: <Code>OTAKIT_TOKEN</Code> {'->'} stored login token
        </li>
        <li>
          Upload path: CLI path argument {'->'} <Code>OTAKIT_BUILD_DIR</Code> {'->'}{' '}
          <Code>capacitor.config.* webDir</Code>
        </li>
        <li>
          Release channel: <Code>--release</Code> {'->'} base channel,{' '}
          <Code>--release &lt;channel&gt;</Code> {'->'} named channel
        </li>
        <li>
          Runtime version: <Code>plugins.OtaKit.runtimeVersion</Code> {'->'} bundle metadata during
          upload
        </li>
        <li>
          Upload version: <Code>--version</Code> {'->'} <Code>OTAKIT_VERSION</Code> {'->'}{' '}
          auto-generated version
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Command reference</H2>

      <div className="space-y-10">
        <Command
          name="otakit upload"
          args="[path]"
          description="Upload a bundle. Optionally release it immediately."
          options={[
            {
              flag: '[path]',
              desc: 'Bundle directory. If omitted, the CLI uses OTAKIT_BUILD_DIR or capacitor.config.* webDir.',
            },
            { flag: '--app-id <id>', desc: 'App ID override.' },
            { flag: '--server <url>', desc: 'Server URL override.' },
            {
              flag: '--version <version>',
              desc: 'Version string. Otherwise OTAKIT_VERSION, then auto-generated.',
            },
            { flag: '--strict-version', desc: 'Require explicit or env-provided version.' },
            {
              flag: '--release [channel]',
              desc: 'Release after upload. Omit channel to release to the base channel.',
            },
          ]}
          example="otakit upload --release"
        />

        <Separator />

        <Command
          name="otakit release"
          args="[bundleId]"
          description="Release a bundle to the base channel or a named channel. The bundle already carries its runtimeVersion, so release only chooses the rollout channel."
          options={[
            {
              flag: '--channel <channel>',
              desc: 'Target named channel. Omit it to use the base channel.',
            },
          ]}
          example="otakit release --channel production"
        />

        <Separator />

        <Command
          name="otakit list"
          description="List uploaded bundles."
          options={[{ flag: '--limit <n>', desc: 'Max results. Defaults to 20.' }]}
          example="otakit list --limit 20"
        />

        <Separator />

        <Command
          name="otakit releases"
          description="Show release history across all streams or a specific target."
          options={[
            { flag: '--channel <channel>', desc: 'Show only a named channel.' },
            { flag: '--base', desc: 'Show only the base channel.' },
            { flag: '--limit <n>', desc: 'Max results. Defaults to 10.' },
          ]}
          example="otakit releases --base"
        />

        <Separator />

        <Command
          name="otakit delete"
          args="<bundleId>"
          description="Delete a bundle."
          options={[{ flag: '--force', desc: 'Skip confirmation prompt.' }]}
          example="otakit delete abc123 --force"
        />

        <Separator />

        <Command
          name="otakit register"
          description="Create a new app and print the plugin snippet to paste into capacitor.config.ts."
          options={[
            { flag: '--slug <slug>', desc: 'App slug (for example com.example.app).' },
            { flag: '--server <url>', desc: 'Server URL override.' },
            { flag: '--token <token>', desc: 'Access token or organization API key.' },
            { flag: '--secret-key <key>', desc: 'Alias for --token.' },
          ]}
          example="otakit register --slug com.example.myapp"
        />

        <Separator />

        <Command
          name="otakit login"
          description="Sign in with email OTP and store a token locally."
          options={[
            { flag: '--email <email>', desc: 'Email address. If omitted, prompts interactively.' },
            { flag: '--server <url>', desc: 'Server URL override.' },
            { flag: '--token-only', desc: 'Print token to stdout only.' },
          ]}
          example="otakit login --email you@example.com"
        />

        <Separator />

        <Command
          name="otakit whoami"
          description="Show current authenticated user and organization context."
          options={[{ flag: '--server <url>', desc: 'Server URL override.' }]}
          example="otakit whoami"
        />

        <Separator />

        <Command
          name="otakit logout"
          description="Remove stored token for a server."
          options={[{ flag: '--server <url>', desc: 'Server URL override.' }]}
          example="otakit logout"
        />

        <Separator />

        <Command
          name="otakit config resolve"
          description="Show effective CLI values and where they came from."
          options={[
            { flag: '--app-id <id>', desc: 'App ID override.' },
            { flag: '--server <url>', desc: 'Server URL override.' },
            { flag: '--output-dir <path>', desc: 'Output directory override.' },
            { flag: '--channel <channel>', desc: 'Channel override.' },
            { flag: '--json', desc: 'Print machine-readable JSON output.' },
          ]}
          example="otakit config resolve --json"
        />

        <Separator />

        <Command
          name="otakit config validate"
          description="Validate the OtaKit-related values in capacitor.config.*."
          options={[{ flag: '--json', desc: 'Print machine-readable JSON output.' }]}
          example="otakit config validate"
        />

        <Separator />

        <Command
          name="otakit generate-signing-key"
          description="Generate an ES256 key pair for manifest signing."
          options={[]}
          example="otakit generate-signing-key"
        />
      </div>

      <Separator className="my-10" />

      <H2>Troubleshooting</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Missing app ID: add <Code>plugins.OtaKit.appId</Code> to <Code>capacitor.config.ts</Code>,
          or pass <Code>--app-id</Code>.
        </li>
        <li>
          Missing <Code>index.html</Code>: build your web app and verify <Code>webDir</Code> or the
          explicit upload path.
        </li>
        <li>
          Need to create an app from automation: use{' '}
          <Code>otakit register --slug &lt;slug&gt;</Code>.
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

function Command({
  name,
  args,
  description,
  options,
  example,
}: {
  name: string;
  args?: string;
  description: string;
  options: Array<{ flag: string; desc: string }>;
  example: string;
}) {
  return (
    <div>
      <h3 className="font-mono text-sm font-semibold">
        {name}
        {args ? <span className="ml-1.5 font-normal text-muted-foreground">{args}</span> : null}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {options.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-lg border text-xs">
          {options.map((opt, i) => (
            <div
              key={opt.flag}
              className={`flex flex-col gap-1 px-4 py-2 sm:flex-row sm:gap-3 ${i < options.length - 1 ? 'border-b' : ''}`}
            >
              <span className="shrink-0 font-mono text-foreground sm:w-52">{opt.flag}</span>
              <span className="text-muted-foreground">{opt.desc}</span>
            </div>
          ))}
        </div>
      ) : null}
      <Pre>{example}</Pre>
    </div>
  );
}
