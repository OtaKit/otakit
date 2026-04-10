import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Channels — OtaKit Docs',
  description:
    'Use the base channel by default, then add named channels only when you need separate rollout tracks.',
};

export default function ChannelsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
      <P>
        Most apps should start with the base channel only. Channels are optional named release
        tracks such as <Code>staging</Code> or <Code>production</Code>.
      </P>

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
        Add a channel only when you want a separate rollout track for a specific build, such as
        internal QA or staged production rollout.
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
          Staging and production: internal builds the base channel or the{' '}
          <Code>channel: "staging"</Code>, production builds use <Code>channel: "production"</Code>.
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
        <li>Add named channels only when you really need separate release tracks.</li>
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
