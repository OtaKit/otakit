import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Channels & Runtime Version — OtaKit Docs',
  description:
    'Use channels for rollout tracks and runtimeVersion for native compatibility boundaries.',
};

export default function ChannelsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Channels & Runtime Version</h1>
      <P>
        Channels control which audience receives a release — for example, a{' '}
        <Code>staging</Code> channel for testers and the default channel for everyone else.
        Runtime version creates a compatibility boundary between native builds and OTA
        bundles — each side only sees releases meant for its version.
      </P>
      <P>Both are optional and build-time settings. Start with neither and add them when needed.</P>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">Channels</h2>

      <Separator className="my-6" />

      <H3>Base channel</H3>
      <P>
        If you omit <Code>channel</Code> from the plugin config, the app uses the unnamed
        base channel. This is the default and the simplest setup.
      </P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID"
  }
}`}</Pre>
      <P>Release to the base channel:</P>
      <Pre>{`otakit upload --release`}</Pre>

      <Separator className="my-6" />

      <H3>Named channels</H3>
      <P>
        Add a channel when you want a separate rollout track — for example, internal QA,
        beta, or a staged production rollout.
      </P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    channel: "staging"
  }
}`}</Pre>
      <P>Release to that channel:</P>
      <Pre>{`otakit upload --release staging`}</Pre>

      <Separator className="my-6" />

      <H3>Promoting across channels</H3>
      <P>You can upload once, test on one channel, then promote the same bundle to another.</P>
      <Pre>{`# Upload and release to staging
otakit upload --release staging

# Promote that bundle to production later
otakit release <bundle-id> --channel production`}</Pre>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">Runtime Version</h2>

      <Separator className="my-6" />

      <H3>When to use it</H3>
      <P>
        <Code>runtimeVersion</Code> is optional. Use it when a new store submission changes
        what the native shell expects from the web bundle. Devices on the old native build
        won&apos;t receive bundles meant for the new one, and devices on the new
        build won&apos;t receive old bundles.
      </P>
      <P>
        Without <Code>runtimeVersion</Code>, all OTA releases share one lane per channel.
        With it, each runtime version gets its own lane.
      </P>

      <Separator className="my-6" />

      <H3>How to use it</H3>
      <P>
        Set <Code>runtimeVersion</Code> in the plugin config before building.
      </P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    runtimeVersion: "2026.04"
  }
}`}</Pre>
      <P>With that config:</P>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>The plugin only requests releases matching that runtime version.</li>
        <li>CLI uploads inherit the same runtime version from the config.</li>
        <li>Old cached OTA bundles from a different runtime are ignored on startup.</li>
      </ul>




      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">Common setups</h2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <strong>Single stream</strong> — no channel, no runtime version. Everything goes to the
          base channel.
        </li>
        <li>
          <strong>Beta + production</strong> — use channels like <Code>beta</Code> and{' '}
          <Code>production</Code> to split audiences.
        </li>
        <li>
          <strong>New store baseline:</strong> — bump{' '}
          <Code>runtimeVersion</Code> so the new native build starts a fresh OTA lane.
        </li>
      </ul>
    </>
  );
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
