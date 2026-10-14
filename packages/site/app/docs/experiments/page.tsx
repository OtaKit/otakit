import Link from 'next/link';

import { Separator } from '@/components/ui/separator';
import { Pre } from '@/app/docs/CodeBlock';

export const metadata = {
  title: 'A/B Tests',
  description:
    'Test config values and code paths on real users of your Capacitor app, without a store release, and see which variant reaches your goal more often. No device identifiers.',
};

export default function ExperimentsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">A/B Tests</h1>
      <P>
        An A/B test gives part of your users another paywall title, onboarding or limit, and shows
        which variant reaches your goal event more often. Variants change{' '}
        <Link
          href="/docs/remote-config"
          className="font-medium text-foreground underline underline-offset-4"
        >
          remote config
        </Link>{' '}
        values, and your code can also branch on the variant. No new store release and no other SDK:
        tests ride in the signed config file and count{' '}
        <Link
          href="/docs/analytics"
          className="font-medium text-foreground underline underline-offset-4"
        >
          custom events
        </Link>
        .
      </P>
      <P>
        A/B tests need <Code>@otakit/capacitor-updater</Code> 3.4 or later in the native build.
        Running tests at once per app: Starter 1, Pro 10, Enterprise and self-hosted servers without
        billing unlimited. Drafts work on every plan.
      </P>

      <Separator className="my-10" />

      <H2>Use it in your app</H2>
      <Pre>{`import { OtaKit, track } from '@otakit/capacitor-updater';

// Config tests: nothing extra. Devices in a variant get its values.
const { values } = await OtaKit.getConfig({ defaults: { paywallTitle: 'Go Pro' } });

// Code tests: branch on the variant.
const variant = await OtaKit.getVariant('new_onboarding'); // 'control', 'b', … or null
if (variant === 'b') showNewOnboarding();
else showOnboarding();

// The goal, where it happens:
track('purchase_completed');`}</Pre>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <Code>getConfig()</Code>, <Code>refreshConfig()</Code> and <Code>configChanged</Code>{' '}
          return the values of the device&apos;s variant for the keys a test overrides.
        </li>
        <li>
          <Code>getVariant(key)</Code> returns the device&apos;s variant, or <Code>null</Code> when
          the device is not in the test (outside its traffic or audience, no such running test, an
          older native plugin, or web). Treat <Code>null</Code> as control.
        </li>
        <li>
          A device counts as in the test from its first <Code>getVariant()</Code> call, or its first{' '}
          <Code>getConfig()</Code> for a test that overrides config. Read the value where it is
          used: devices that never get there are not counted, which keeps results sharp.
        </li>
        <li>
          The goal is a custom event name. A device converts the first time it tracks the goal after
          it joined the test. This follows your <Code>track()</Code> call even when analytics
          sampling or <Code>beforeSend</Code> drops the event.
        </li>
        <li>
          With{' '}
          <Link
            href="/docs/error-tracking"
            className="font-medium text-foreground underline underline-offset-4"
          >
            error tracking
          </Link>{' '}
          on, devices also report their first error after joining, so a variant that breaks
          something shows up as a guardrail.
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Create and start a test</H2>
      <P>
        In the dashboard, the app&apos;s <strong>A/B tests</strong> section creates tests:
      </P>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <strong>Key</strong>, used in <Code>getVariant()</Code>. It is unique among the app&apos;s
          draft and running tests; once a test ends, the key can be used again.
        </li>
        <li>
          <strong>Config</strong>: the base config, which reaches every channel without its own
          config, or a channel&apos;s own config. On the base config, a test can be limited to some
          channels. Optionally, limit it to runtime versions.
        </li>
        <li>
          <strong>Devices in the test</strong>: the share of devices that join (default 100%). The
          rest keep the normal values and are not counted.
        </li>
        <li>
          <strong>Variants</strong>: <Code>control</Code>, which keeps the normal values, and up to
          4 more, with weights that add up to 100 and the config values each one overrides (leave
          them empty for a code test).
        </li>
        <li>
          <strong>Goal</strong> and up to 3 other goals. The dialog estimates how many devices a
          clear result needs, from the last 14 days of events.
        </li>
      </ul>
      <P>
        Starting writes a new version of the config file, so devices pick the test up on their next
        config fetch (at launch, or on resume after <Code>checkInterval</Code>). While a test runs,
        only its name can change: changing weights or values would move devices between variants. To
        change it, stop it and run it again with the new settings. Two running tests on one config
        cannot override the same key.
      </P>

      <Separator className="my-10" />

      <H2>How devices are assigned</H2>
      <P>
        On first use, the plugin stores a random secret on the device. It never leaves the device.
        For each test, the device hashes the secret with the test&apos;s ID into two numbers from 1
        to 100: one decides whether it joins (traffic), the other its variant (weights). The same
        device always gets the same variant in a test, tests are independent of each other and of{' '}
        <Link
          href="/docs/rollouts"
          className="font-medium text-foreground underline underline-offset-4"
        >
          rollouts
        </Link>
        , and running a test again reshuffles devices.
      </P>

      <Separator className="my-10" />

      <H2>Results</H2>
      <P>
        Each device reports at most once per test: when it joins, the first time it tracks each goal
        after that, and its first error after that. OtaKit counts these reports per variant, so the
        numbers are devices, without any device identifier. For each variant the results show:
      </P>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>Devices in the test, devices that converted, and the conversion rate.</li>
        <li>
          Lift against control, with a 95% interval, and the probability that the variant is the
          best one (Bayesian, with a uniform prior).
        </li>
        <li>The share of devices with an error after joining (the guardrail).</li>
        <li>The other goals, and conversion by day.</li>
      </ul>
      <P>The verdict reads:</P>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <strong>Not enough data yet</strong> until the test ran 7 days and every variant has 100
          conversions. Checking early is fine; deciding early is not.
        </li>
        <li>
          <strong>B is better</strong> when one variant has at least 95% probability to be the best.
          When it is control, keep the current values.
        </li>
        <li>
          <strong>No clear difference</strong> when every variant reached the planned sample (the
          devices needed to detect a 20% change) without a winner.
        </li>
        <li>
          <strong>B has more errors</strong> when a variant has more devices with errors than
          control with at least 95% probability (and at least 10 such devices), at any time.
        </li>
      </ul>
      <P>
        Each verdict is sent once as the <Code>experiment.verdict_reached</Code>{' '}
        <Link
          href="/docs/webhooks"
          className="font-medium text-foreground underline underline-offset-4"
        >
          notification
        </Link>
        , by email to owners and admins by default. Results stay readable after a test ends, for 13
        months.
      </P>

      <Separator className="my-10" />

      <H2>Ship the winner</H2>
      <P>
        <strong>Ship</strong> on a running or stopped test writes the variant&apos;s values into the
        config for every device, as a new config version, and ends the test. The dialog shows each
        value before and after. Shipping control keeps the values. <strong>Stop</strong> ends a test
        without changing values: devices get the normal config on their next fetch.
      </P>

      <Separator className="my-10" />

      <H2>CLI, API and agents</H2>
      <Pre>{`otakit experiments list
otakit experiments results paywall_title
otakit experiments create --file test.json --start
otakit experiments stop paywall_title
otakit experiments ship paywall_title --variant b`}</Pre>
      <P>
        The{' '}
        <Link href="/docs/api" className="font-medium text-foreground underline underline-offset-4">
          REST API
        </Link>{' '}
        has the same operations. Agents use the MCP tools <Code>list_experiments</Code>,{' '}
        <Code>get_experiment_results</Code>, <Code>stop_experiment</Code> and{' '}
        <Code>ship_experiment_variant</Code>; stopping and shipping ask for approval in clients that
        support it.
      </P>

      <Separator className="my-10" />

      <H2>Privacy and limits</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          No user or device identifiers are sent. The device keeps its secret and a list of the
          reports it made for its 50 newest tests.
        </li>
        <li>
          Reports are custom events (<Code>$exposure</Code>, <Code>$conversion</Code>,{' '}
          <Code>$experiment_error</Code>) and count toward the monthly custom events limit, once per
          device and test each. When analytics is paused by the limit, results say so.
        </li>
        <li>
          Up to 10 running tests per config, 5 variants per test, 8 KiB of overrides per variant.
          Config values are public to anyone with the app, test values included.
        </li>
        <li>
          Devices with JavaScript or a native plugin older than 3.4 are not in tests: they keep the
          normal values and are not counted.
        </li>
      </ul>
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
