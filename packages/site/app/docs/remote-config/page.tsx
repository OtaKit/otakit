import Link from 'next/link';

import { Separator } from '@/components/ui/separator';
import { Pre } from '@/app/docs/CodeBlock';

export const metadata = {
  title: 'Remote Config',
  description:
    'Change kill switches, URLs, limits and banners in a running Capacitor app without a new bundle or store release.',
};

export default function RemoteConfigPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Remote Config</h1>
      <P>
        Remote config is a small JSON object per channel that your app reads at runtime. Change it
        in the dashboard, with the CLI, over the API or through an agent, and running apps pick it
        up without a new bundle or store build. Use it for kill switches, support URLs, limits,
        maintenance banners and feature flags.
      </P>
      <P>
        Reading config needs <Code>@otakit/capacitor-updater</Code> 3.4 or later. Publishing works
        on every plan; Free covers the base channel, and paid plans can give named channels their
        own config.
      </P>

      <Separator className="my-10" />

      <H2>Read it in your app</H2>
      <Pre>{`import { OtaKit } from '@otakit/capacitor-updater';

const defaults = { checkoutEnabled: true, helpUrl: 'https://example.com/help' };

// Add the listener first: a change fetched at launch is delivered to it.
OtaKit.addListener('configChanged', (next) => applyConfig({ ...defaults, ...next.values }));

const config = await OtaKit.getConfig({ defaults });
applyConfig(config.values);`}</Pre>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <Code>getConfig()</Code> answers instantly from the device: the config saved by the last
          fetch, with remote values over your <Code>defaults</Code>. It never waits for the network,
          so call it during startup.
        </li>
        <li>
          The plugin fetches config when the app launches, when it returns to the foreground (at
          most every <Code>checkInterval</Code>, 10 minutes by default) and after{' '}
          <Code>setChannel()</Code>, whatever your update policies are. <Code>configChanged</Code>{' '}
          fires when a fetch changes the config.
        </li>
        <li>
          <Code>refreshConfig()</Code> fetches now and resolves with the result. Network errors do
          not throw: the result has an <Code>error</Code> code and the saved config.
        </li>
        <li>
          <Code>source</Code> says where values came from: <Code>remote</Code> (fetched in this
          session), <Code>cache</Code> (saved earlier) or <Code>defaults</Code> (no remote config
          yet). Offline, the app keeps the last config it verified.
        </li>
        <li>
          New JavaScript sent over the air may reach phones whose native plugin is older than 3.4.
          There the methods return your defaults instead of throwing.
        </li>
      </ul>
      <P>
        Values are plain JSON. Treat a key as possibly missing or of another type, and keep a code
        default for every key your app depends on.
      </P>

      <Separator className="my-10" />

      <H2>Change it</H2>
      <P>
        In the dashboard, the app&apos;s <strong>Remote config</strong> section shows each
        channel&apos;s values. Edit the JSON, add a short note about why, review the changed keys
        and publish. Every change is a new version; <strong>History</strong> lists them and restores
        an earlier one as a new version.
      </P>
      <Pre>{`otakit remote-config set checkoutEnabled false --message "Partner outage"
otakit remote-config set helpUrl https://example.com/support
otakit remote-config unset maintenanceBanner
otakit remote-config get                       # the base channel
otakit remote-config get --channel beta --values > beta.json
otakit remote-config push beta.json --channel beta
otakit remote-config history
otakit remote-config restore 12`}</Pre>
      <P>
        <Code>set</Code> reads the value as JSON when it parses (<Code>false</Code>, <Code>5</Code>,{' '}
        <Code>{'{"limit":3}'}</Code>) and as text otherwise; add <Code>--string</Code> to keep text
        that looks like JSON. Agents use <Code>get_remote_config</Code> and{' '}
        <Code>set_remote_config</Code>, and ask before changing anything. The{' '}
        <Link href="/docs/api" className="font-medium text-foreground underline underline-offset-4">
          REST API
        </Link>{' '}
        has the same operations.
      </P>
      <P>
        Every write names the version it is based on (<Code>expectedVersion</Code>). If someone
        changed the config in the meantime, the write is refused instead of overwriting their
        change; read it again and reapply yours.
      </P>

      <Separator className="my-10" />

      <H2>Channels</H2>
      <P>
        Each channel can have its own config. A channel without one uses the base channel&apos;s
        config, so a kill switch on the base channel also reaches beta testers. Give a channel its
        own config to change values only there; it then replaces the base config as a whole, with no
        merging of keys.
      </P>
      <P>
        Deleting a channel&apos;s config sends its devices back to the base config. Deleting the
        base config leaves apps on their code defaults. History is kept either way. A config with
        running A/B tests cannot be deleted until they stop.
      </P>

      <Separator className="my-10" />

      <H2>A/B tests</H2>
      <P>
        An{' '}
        <Link
          href="/docs/experiments"
          className="font-medium text-foreground underline underline-offset-4"
        >
          A/B test
        </Link>{' '}
        runs on a config: devices in a variant get its values for the keys it overrides, through the
        same <Code>getConfig()</Code>. Starting, stopping and shipping a test publish new config
        versions, and shipping a variant writes its values into the config for everyone. Values you
        publish meanwhile keep the running tests. Giving a channel its own config takes its devices
        out of tests on the base config: OtaKit warns, and refuses when a running test targets that
        channel by name.
      </P>

      <Separator className="my-10" />

      <H2>Limits and rules</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>A JSON object of up to 16 KB with at most 200 top-level keys.</li>
        <li>
          Keys use letters, digits, <Code>.</Code>, <Code>_</Code> and <Code>-</Code>, up to 64
          characters.
        </li>
        <li>
          Config is public: anyone with your app can read it. OtaKit warns when a key or value looks
          like a secret, such as a key named <Code>apiKey</Code> or a token-shaped value. Never put
          secrets in config.
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Notifications and audit</H2>
      <P>
        Every change is in the audit log. Add the <Code>config.updated</Code> event to a{' '}
        <Link
          href="/docs/webhooks"
          className="font-medium text-foreground underline underline-offset-4"
        >
          notification destination
        </Link>{' '}
        to see changes in Slack, Discord, email or your own systems, with the keys that changed and
        the note.
      </P>

      <Separator className="my-10" />

      <H2>Security</H2>
      <P>
        Config files are signed with the same key as release manifests. The app ignores a file that
        is unsigned, tampered with, meant for another app or channel, or older than one it already
        accepted. Deletions are signed too, so they cannot be faked by blocking a file.
      </P>
    </>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-semibold tracking-tight">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-muted-foreground">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
}
