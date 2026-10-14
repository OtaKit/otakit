import Link from 'next/link';

import { Separator } from '@/components/ui/separator';
import { Pre } from '@/app/docs/CodeBlock';

export const metadata = {
  title: 'Analytics',
  description:
    'Send custom events from your Capacitor app and see how often they happen, split by any property, and per OTA release. No user or device identifiers.',
};

export default function AnalyticsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
      <P>
        Send custom events from your app with one call. OtaKit adds the OTA release, channel,
        platform and OS version, and shows how often each event happens, how it splits by any of its
        properties, and how it changed between releases, for example after a rollout.
      </P>
      <P>
        It needs <Code>@otakit/capacitor-updater</Code> 3.4 or later. It answers the common
        questions without a query language; it is not a full product analytics suite (no funnels,
        cohorts or user profiles).
      </P>

      <Separator className="my-10" />

      <H2>Send events</H2>
      <Pre>{`import { initAnalytics, track } from '@otakit/capacitor-updater';

// Once at startup: counts app launches, the base of per-release rates.
initAnalytics();

track('checkout_completed', { plan: 'pro', value: 49 });`}</Pre>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Names use 1–64 letters, numbers, <Code>.</Code>, <Code>_</Code>, <Code>:</Code> and{' '}
          <Code>-</Code>, such as <Code>checkout_completed</Code>. Keep IDs out of names: put them
          in properties, or leave them out.
        </li>
        <li>
          Up to 20 properties with string (up to 200 characters), number or boolean values. Other
          values are left out. <Code>OtaKit.track()</Code> is the same function.
        </li>
        <li>
          <Code>track()</Code> works without <Code>initAnalytics()</Code>. With it, the plugin sends{' '}
          <Code>$session_start</Code> once per app launch, so releases can be compared per 1,000 app
          launches.
        </li>
        <li>
          Events are buffered for up to 5 seconds and delivered from a native outbox that survives
          reloads, crashes and offline periods for up to 3 days, together with{' '}
          <Link
            href="/docs/error-tracking"
            className="font-medium text-foreground underline underline-offset-4"
          >
            errors
          </Link>
          .
        </li>
        <li>On web, and with a native plugin older than 3.4, nothing is sent.</li>
      </ul>
      <Pre>{`initAnalytics({
  sessionEvents: true,      // $session_start once per app launch
  sampleRate: 1,            // share of app launches whose events are sent, 0 to 1
  maxEventsPerSession: 1000,
  beforeSend(event) {
    // Change the event, or return null to drop it.
    return event;
  },
});`}</Pre>

      <Separator className="my-10" />

      <H2>In the dashboard</H2>
      <P>
        The app&apos;s <strong>Analytics</strong> section lists events with their count, app
        launches, trend, and change against the previous period of the same length. Filter by time
        range (up to 90 days), platform and release. <strong>Live</strong> shows events as they
        arrive, to check the setup.
      </P>
      <P>An event shows:</P>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>Events per hour or day.</li>
        <li>
          A split by any property: the 10 most common values and the rest. Raw events are kept 90
          days.
        </li>
        <li>
          A comparison of the latest releases of a channel: events per 1,000 app launches on each
          release, and the difference from the oldest. Without <Code>initAnalytics()</Code>, rates
          use applies from phones on plugin 3.4+, which is less precise. Counts per release are kept
          13 months.
        </li>
      </ul>
      <P>Tables can be copied as CSV.</P>

      <Separator className="my-10" />

      <H2>Agents and API</H2>
      <P>
        Agents read events with the MCP tools <Code>list_app_events</Code> and{' '}
        <Code>query_app_event</Code>, for example &quot;did checkout completions change after
        yesterday&apos;s release?&quot;. The{' '}
        <Link href="/docs/api" className="font-medium text-foreground underline underline-offset-4">
          REST API
        </Link>{' '}
        has the same reads.
      </P>

      <Separator className="my-10" />

      <H2>Limits</H2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-4 font-medium">Plan</th>
              <th className="py-2 pr-4 font-medium">Custom events per month</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b">
              <td className="py-2 pr-4">Free</td>
              <td className="py-2 pr-4">100,000</td>
            </tr>
            <tr className="border-b">
              <td className="py-2 pr-4">Starter</td>
              <td className="py-2 pr-4">1,000,000</td>
            </tr>
            <tr className="border-b">
              <td className="py-2 pr-4">Pro</td>
              <td className="py-2 pr-4">10,000,000</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Enterprise</td>
              <td className="py-2 pr-4">Custom</td>
            </tr>
          </tbody>
        </table>
      </div>
      <P>
        <Code>$session_start</Code> counts as an event. Months are calendar months in UTC. Above the
        limit, new events are not recorded until the next month, and the{' '}
        <Code>analytics.paused</Code> notification goes to the default email destination. Upgrading
        resumes recording within minutes. Self-hosted servers without billing have no limit.
      </P>

      <Separator className="my-10" />

      <H2>Privacy</H2>
      <P>
        Nothing is sent until your code calls <Code>track()</Code> or <Code>initAnalytics()</Code>.
        Events carry no user or device identifier: app launches are counted with a random ID that is
        made at each launch and never stored on the phone. You choose the properties, so keep
        personal data out of them, or remove it in <Code>beforeSend</Code>.
      </P>
      <P>
        For the App Store privacy label, declare <strong>Product Interaction</strong>, not linked to
        the user&apos;s identity and not used for tracking. In Google Play&apos;s Data safety form,
        declare <strong>App interactions</strong> under App activity, collected for analytics, not
        shared.
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
