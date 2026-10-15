import Link from 'next/link';

import { Separator } from '@/components/ui/separator';
import { Pre } from '@/app/docs/CodeBlock';

export const metadata = {
  title: 'Error Tracking',
  description:
    'See which OTA release broke what: JavaScript errors from your Capacitor app, grouped into issues per release, with alerts for new errors, regressions and spikes.',
};

export default function ErrorTrackingPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Error Tracking</h1>
      <P>
        Error tracking sends the JavaScript errors of your Capacitor app to OtaKit. OtaKit groups
        the same error into one issue across builds and shows the exact OTA release, channel,
        platform and OS version it happened on. You get alerts for new errors, errors that come back
        after you resolved them, and releases with an error spike.
      </P>
      <P>
        It needs <Code>@otakit/capacitor-updater</Code> 3.4 or later and one line of code. It
        informs: it never rolls a release back on its own.
      </P>

      <Separator className="my-10" />

      <H2>Turn it on</H2>
      <Pre>{`import { initErrorTracking } from '@otakit/capacitor-updater';

// Once, as early as possible (for example in main.ts):
initErrorTracking();`}</Pre>
      <P>
        From then on, uncaught errors and unhandled promise rejections are sent. To check the setup,
        call <Code>testErrorTracking()</Code> once: a test error appears in the app&apos;s{' '}
        <strong>Errors</strong> section within a minute.
      </P>
      <P>
        Send errors you catch yourself with <Code>captureError()</Code>:
      </P>
      <Pre>{`import { captureError } from '@otakit/capacitor-updater';

try {
  await submitOrder();
} catch (error) {
  captureError(error, { tags: { screen: 'checkout' } });
  showRetry();
}`}</Pre>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Errors are buffered for up to 5 seconds and handed to the native plugin, which stores them
          on the device and sends them in the background. They survive reloads, crashes and offline
          periods for up to 3 days.
        </li>
        <li>
          Each error carries the running bundle and release, channel, runtime version, native build,
          OS version and a random ID for the app launch. No user or device identifiers.
        </li>
        <li>
          On web, and with a native plugin older than 3.4, the functions do nothing and log one
          warning.
        </li>
        <li>
          Same-origin errors keep their message and stack: Capacitor serves your app from its own
          origin, so errors are not reduced to <Code>Script error.</Code>
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Options</H2>
      <Pre>{`initErrorTracking({
  sampleRate: 1, // share of errors to send, 0 to 1
  ignoreErrors: ['NetworkError', /^AbortError:/],
  maxEventsPerSession: 100, // per app launch or reload
  beforeSend(error) {
    // Change the error, or return null to drop it.
    if (error.route?.startsWith('/admin')) return null;
    return error;
  },
});`}</Pre>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          A string in <Code>ignoreErrors</Code> matches anywhere in <Code>name: message</Code>; a
          RegExp is tested against it.
        </li>
        <li>
          The same error is sent at most 5 times per app launch (or reload), and at most{' '}
          <Code>maxEventsPerSession</Code> errors in total, so a loop that throws cannot flood your
          account.
        </li>
        <li>
          Browser noise with nothing to fix in your code, such as <Code>ResizeObserver loop</Code>{' '}
          messages, is dropped.
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Issues</H2>
      <P>
        Errors with the same cause form an issue. OtaKit groups by the error name, the message with
        its variable parts replaced (numbers, IDs and quoted values), and the first three frames of
        your own code. Content hashes in file names (<Code>index-4f3a9c2b.js</Code>) are ignored, so
        an issue stays the same across builds.
      </P>
      <P>
        The app&apos;s <strong>Errors</strong> section lists issues with their events, app launches
        affected (sessions), releases and trend. Filter by time range, status, platform and release.
        An issue shows its latest stack trace, recent events and where it happens: by release,
        platform, OS version, native build, channel and route. <strong>Copy as Markdown</strong>{' '}
        puts all of it on the clipboard for a ticket or an agent.
      </P>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <strong>Resolve</strong> an issue when you shipped the fix. OtaKit remembers the releases
          it happened on. If it happens on another release, such as the one with your fix or a later
          one, it reopens and you get an <Code>errors.regression</Code> alert. Phones still on the
          old releases (during a rollout, or before they update) do not reopen it, and neither do
          errors from before the fix that reach OtaKit late from an offline phone.
        </li>
        <li>
          <strong>Ignore</strong> an issue you will not fix. It keeps counting, also in release
          error rates, but sends no alerts of its own.
        </li>
        <li>
          A release&apos;s health dialog shows its error events, issues (and how many are new in it)
          and errors per 1,000 applies, next to the release it replaced. Applies count only phones
          whose native plugin can report errors (3.4+), so the rate does not change as a new store
          build spreads.
        </li>
      </ul>
      <P>
        Stack traces are minified unless your production build keeps names. Source maps are not
        supported yet.
      </P>

      <Separator className="my-10" />

      <H2>Alerts</H2>
      <P>
        Add these events to a{' '}
        <Link
          href="/docs/webhooks"
          className="font-medium text-foreground underline underline-offset-4"
        >
          notification destination
        </Link>{' '}
        (Slack, Discord, email or a webhook):
      </P>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <Code>errors.new_issue</Code>: an issue first seen in the last 24 hours reaches 5 events.
          Once per issue.
        </li>
        <li>
          <Code>errors.regression</Code>: a resolved issue happened on a release it had not happened
          on before, and reopened.
        </li>
        <li>
          <Code>errors.spike</Code>: in the 14 days after it is published, a release has at least 3
          times the errors per 1,000 applies of the release before it on its channel and runtime
          version, with at least 50 applies and 20 errors. The release before it needs 50 applies
          and at least one error, so a release that did not track errors yet is not a baseline. Once
          per release.
        </li>
        <li>
          <Code>errors.paused</Code>: the workspace reached its monthly error limit.
        </li>
      </ul>
      <P>
        The default &quot;Owners and admins&quot; email destination includes regressions, spikes and
        the monthly limit. Error text in alerts is shown as code, never as a link.
      </P>

      <Separator className="my-10" />

      <H2>Agents and API</H2>
      <P>
        Agents read issues with the MCP tools <Code>list_error_issues</Code> and{' '}
        <Code>get_error_issue</Code>, for example &quot;what are the top errors on production since
        yesterday?&quot; or &quot;find and fix the cause of this error&quot;. The{' '}
        <Link href="/docs/api" className="font-medium text-foreground underline underline-offset-4">
          REST API
        </Link>{' '}
        lists issues, returns one with its samples, and changes its status.
      </P>

      <Separator className="my-10" />

      <H2>Limits</H2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-4 font-medium">Plan</th>
              <th className="py-2 pr-4 font-medium">Error events per month</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            <tr className="border-b">
              <td className="py-2 pr-4">Free</td>
              <td className="py-2 pr-4">10,000</td>
            </tr>
            <tr className="border-b">
              <td className="py-2 pr-4">Starter</td>
              <td className="py-2 pr-4">100,000</td>
            </tr>
            <tr className="border-b">
              <td className="py-2 pr-4">Pro</td>
              <td className="py-2 pr-4">1,000,000</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Enterprise</td>
              <td className="py-2 pr-4">Custom</td>
            </tr>
          </tbody>
        </table>
      </div>
      <P>
        Months are calendar months in UTC. Above the limit, new errors are not recorded until the
        next month; upgrading resumes recording within minutes. Events are kept for 30 days, daily
        counts per issue and release for 180 days. Self-hosted servers without billing have no
        limit.
      </P>

      <Separator className="my-10" />

      <H2>Privacy</H2>
      <P>
        Nothing is collected until your code calls <Code>initErrorTracking()</Code>. Before an error
        leaves the device, the plugin replaces email addresses, bearer tokens, JWTs, long random
        keys, <Code>password=</Code>-style values and URL query strings with <Code>[redacted]</Code>
        . Use <Code>beforeSend</Code> for anything specific to your app. The server also strips URL
        hosts from the grouped message.
      </P>
      <P>
        For the App Store privacy label, declare <strong>Crash Data</strong> or{' '}
        <strong>Other Diagnostic Data</strong>: not linked to the user&apos;s identity and not used
        for tracking. In Google Play&apos;s Data safety form, declare <strong>Crash logs</strong>{' '}
        and <strong>Diagnostics</strong> under App info and performance, collected for analytics,
        not shared.
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
