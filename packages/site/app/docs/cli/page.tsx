import { Separator } from '@/components/ui/separator';
import { Pre } from '@/app/docs/CodeBlock';

export const metadata = {
  title: 'CLI Reference',
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
      <P>
        If your account has multiple organizations, login asks you to choose a default by name for
        commands that are not tied to an app. Change it with <Code>otakit organization select</Code>
        . Configured apps still use their owning organization, and organization keys are already
        bound to one.
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
          App-less organization: <Code>OTAKIT_ORGANIZATION_ID</Code> {'->'} stored login default
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
            {
              flag: '--strategy <strategy>',
              desc: 'Upload strategy: "zip" (single archive, default) or "deltas" (per-file objects; devices download only what changed).',
            },
            {
              flag: '--force-immediate',
              desc: 'With --release: devices apply and reload this release on their next check (emergency fixes).',
            },
            {
              flag: '--rollout <percent>',
              desc: 'With --release: release to this share of devices first (1-100, default 100). See Percentage rollouts.',
            },
            {
              flag: '--replace-rollout',
              desc: "With --release: cancel the channel's active rollout and release this bundle in its place.",
            },
            {
              flag: '--notes <text>',
              desc: 'With --release: release notes app users may see (plain text, up to 2,000 characters). See Release notes.',
            },
            {
              flag: '--notes-file <path>',
              desc: 'With --release: read the release notes from a file.',
            },
            {
              flag: '--preview',
              desc: 'Also create a preview link and QR code for the uploaded bundle. See Preview links.',
            },
            {
              flag: '--encrypt',
              desc: 'Encrypt the bundle with OTAKIT_ENCRYPTION_KEY before upload (auto-enabled when the env var is set).',
            },
            {
              flag: '--fail-on-incompatible',
              desc: 'Exit non-zero when the native compatibility check finds changes that need a store build.',
            },
            { flag: '--ignore-compat', desc: 'Skip the native compatibility check.' },
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
            {
              flag: '--force-immediate',
              desc: 'Devices apply and reload this release on their next check (emergency fixes).',
            },
            {
              flag: '--rollout <percent>',
              desc: 'Release to this share of devices first (1-100, default 100). The channel needs a previous release.',
            },
            {
              flag: '--replace-rollout',
              desc: "Cancel the channel's active rollout and release this bundle in its place.",
            },
            {
              flag: '--notes <text>',
              desc: 'Release notes app users may see (plain text, up to 2,000 characters). Edit them later in the dashboard.',
            },
            { flag: '--notes-file <path>', desc: 'Read the release notes from a file.' },
          ]}
          example="otakit release --channel production --rollout 10"
        />

        <Separator />

        <Command
          name="otakit rollout"
          args="[releaseId]"
          description="Show active rollouts, or raise, lower, complete, or cancel one. Without a release ID it acts on the rollout of the selected channel."
          options={[
            { flag: '--channel <channel>', desc: 'Channel of the rollout.' },
            { flag: '--base', desc: 'The rollout on the base channel.' },
            {
              flag: '--percent <percent>',
              desc: 'Set the share of devices (1-100; 100 completes the rollout).',
            },
            { flag: '--complete', desc: 'Release to every device.' },
            {
              flag: '--cancel',
              desc: 'Revert the rolling release; every device returns to the previous release.',
            },
          ]}
          example="otakit rollout --channel production --percent 50"
        />

        <Separator />

        <Command
          name="otakit preview"
          args="[bundleId]"
          description="Create a private link and QR code that open a bundle in the installed app on one phone, without releasing it. Defaults to the latest upload. The app needs previewLinks: true and a custom URL scheme."
          options={[
            {
              flag: '--expires <duration>',
              desc: 'How long the link works: 1h, 24h, 7d (default) or 30d.',
            },
            {
              flag: '--scheme <scheme>',
              desc: "The app's custom URL scheme, such as myapp. Needed once; the app remembers it.",
            },
            { flag: '--list', desc: 'List active preview links.' },
            { flag: '--revoke <previewId>', desc: 'Revoke a preview link.' },
            { flag: '--json', desc: 'Print JSON output.' },
          ]}
          example="otakit preview --scheme myapp"
        />

        <Separator />

        <Command
          name="otakit compatibility"
          description="Check the local native plugin set against a channel's current release without uploading."
          options={[
            {
              flag: '--channel <channel>',
              desc: 'Channel to compare against. Omit for the base channel.',
            },
            {
              flag: '--package-json <path>',
              desc: 'package.json used for native dependency detection.',
            },
            {
              flag: '--node-modules <path>',
              desc: 'node_modules used for native dependency detection.',
            },
          ]}
          example="otakit compatibility --channel production"
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
          options={[
            { flag: '--server <url>', desc: 'Server URL override.' },
            { flag: '--json', desc: 'Print machine-readable account and organization details.' },
          ]}
          example="otakit whoami"
        />

        <Separator />

        <Command
          name="otakit organization select"
          description="Choose the default organization for commands not tied to an app. Configured apps always use their owning organization."
          options={[{ flag: '--server <url>', desc: 'Server URL override.' }]}
          example="otakit organization select"
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
          name="otakit connect"
          description="Connect this project to your coding agent. Signs in if needed, then writes the client's MCP configuration after showing exactly what it resolved and what it will write."
          options={[
            { flag: '--client <client>', desc: 'claude, codex, or vscode. Defaults to detected.' },
            {
              flag: '--project-root <path>',
              desc: 'Project to connect. Defaults to the current directory.',
            },
            { flag: '--server <url>', desc: 'OtaKit console URL override.' },
            { flag: '--dry-run', desc: 'Show the plan and exit without writing.' },
            { flag: '--yes', desc: 'Skip the confirmation prompt.' },
          ]}
          example="npx -y @otakit/cli@latest connect"
        />

        <Separator />

        <Command
          name="otakit push send"
          description="Send a push notification to your app users. Needs the Push notifications add-on (Settings → Add-ons) and an APNs key and/or Firebase service account for the app. Shows the audience size and asks before sending."
          options={[
            { flag: '--title <title>', desc: 'Notification title (required).' },
            { flag: '--body <body>', desc: 'Notification text (required).' },
            { flag: '--url <url>', desc: 'Path or https link the app opens, sent as data.url.' },
            { flag: '--data <key=value>', desc: 'Extra data for the app (repeatable).' },
            { flag: '--platform <platform>', desc: 'ios or android (repeatable; default both).' },
            { flag: '--channel <channel>', desc: 'Only devices on this OTA channel (repeatable).' },
            {
              flag: '--topic <topic>',
              desc: 'Only devices subscribed to this topic (repeatable).',
            },
            { flag: '--user <id>', desc: 'Only devices of this user ID (repeatable).' },
            { flag: '--yes', desc: 'Send without the confirmation prompt (required in CI).' },
            { flag: '--json', desc: 'Print the campaign as JSON.' },
          ]}
          example='otakit push send --title "New drop" --body "Open the app to see it" --url /shop --topic news'
        />

        <Separator />

        <Command
          name="otakit push campaigns"
          description="List recent push campaigns with delivery counts."
          options={[
            { flag: '--limit <n>', desc: 'Number of campaigns (default 10, max 100).' },
            { flag: '--json', desc: 'Print machine-readable JSON output.' },
          ]}
          example="otakit push campaigns"
        />

        <Separator />

        <Command
          name="otakit push campaign"
          args="<campaignId>"
          description="Show one campaign: status, devices targeted and accepted by Apple/Google, failures and removed tokens."
          options={[{ flag: '--json', desc: 'Print machine-readable JSON output.' }]}
          example="otakit push campaign 11dead02-8f6f-4349-8ea3-7667c2a4382c"
        />

        <Separator />

        <Command
          name="otakit mcp"
          description="Start the local MCP server, bound to one project and organization for its lifetime."
          options={[
            { flag: '--project-root <path>', desc: 'Project root available to local MCP tools.' },
            {
              flag: '--organization-id <id>',
              desc: 'Advanced organization override for app-less automation.',
            },
          ]}
          example="npx -y @otakit/cli@latest mcp --project-root ."
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

        <Separator />

        <Command
          name="otakit generate-encryption-key"
          description="Generate an AES-256 bundle encryption key. Keep it in CI as OTAKIT_ENCRYPTION_KEY and ship it in the app's bundleKeys config."
          options={[]}
          example="otakit generate-encryption-key"
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
