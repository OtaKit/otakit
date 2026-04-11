import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Channels — OtaKit Docs',
  description:
    'Use channels for rollout tracks and runtimeVersion for native compatibility boundaries.',
};

export default function ChannelsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
      <P>
        Channels and runtime version solve different problems. Channels decide who gets
        a rollout. Runtime version decides which native app shell can safely run it.
      </P>

      <Separator className="my-10" />

      <H2>Channel vs runtime version</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <Code>channel</Code> answers: who should get this rollout?
        </li>
        <li>
          <Code>runtimeVersion</Code> answers: which native app shell can safely run this bundle?
        </li>
        <li>
          Use channels for rollout tracks such as <Code>beta</Code>, <Code>staging</Code>, or{' '}
          <Code>production</Code>.
        </li>
        <li>
          Use <Code>runtimeVersion</Code> when a new store build creates a compatibility boundary
          and must stop receiving older OTA bundles.
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Base channel first</H2>
      <P>
        If you omit <Code>channel</Code> from the plugin config, the app uses the base channel.
      </P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID"
  }
}`}</Pre>
      <P>Release to the base channel with:</P>
      <Pre>{`otakit upload --release`}</Pre>

      <Separator className="my-10" />

      <H2>Named channels</H2>
      <P>
        Add a channel only when you want a separate rollout track, such as internal QA, beta, or a
        staged production rollout.
      </P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    channel: "staging"
  }
}`}</Pre>
      <P>Release to that channel with:</P>
      <Pre>{`otakit upload --release staging`}</Pre>

      <Separator className="my-10" />

      <H2>Runtime version for store updates</H2>
      <P>
        <Code>runtimeVersion</Code> is optional, but it is the right tool when a new App Store or
        Play Store submission creates a new OTA baseline.
      </P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    channel: "production",
    runtimeVersion: "2026.04"
  }
}`}</Pre>
      <P>With that config:</P>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          the plugin only asks for releases on <Code>(channel, runtimeVersion)</Code>
        </li>
        <li>
          bundle uploads inherit <Code>runtimeVersion</Code> automatically from the same plugin config
        </li>
        <li>
          releases stay simple: publish the bundle, and it naturally stays inside its own runtime
          lane
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Promote an existing bundle</H2>
      <P>You can upload once, test it, then promote the same bundle to another channel later.</P>
      <Pre>{`# Upload and release to staging
otakit upload --release staging

# Promote that bundle to production later
otakit release <bundle-id> --channel production`}</Pre>

      <Separator className="my-10" />

      <H2>Common setups</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          One stream only: no channel in the app config, release everything to the base channel.
        </li>
        <li>
          Beta and production: use channels like <Code>beta</Code> and <Code>production</Code> to
          split rollout audiences.
        </li>
        <li>
          New store baseline: keep the same channels, but bump <Code>runtimeVersion</Code> so the
          new native build starts a fresh OTA lane.
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Rules</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Channel is a build-time setting in <Code>capacitor.config.ts</Code>.
        </li>
        <li>
          Omit <Code>channel</Code> to use the base channel.
        </li>
        <li>
          <Code>runtimeVersion</Code> is also a build-time setting. Leave it unset unless you need
          a compatibility boundary.
        </li>
        <li>
          The same named channel can have parallel current releases across different runtime
          versions.
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
