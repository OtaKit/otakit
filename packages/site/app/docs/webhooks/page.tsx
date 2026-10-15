import Link from 'next/link';

import { Separator } from '@/components/ui/separator';
import { Pre } from '@/app/docs/CodeBlock';

export const metadata = {
  title: 'Webhooks and Alerts',
  description:
    'Get release, rollout, auto-revert, upload and usage events by email, in Slack or Discord, or as signed webhooks.',
};

export default function WebhooksPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Webhooks and Alerts</h1>
      <P>
        OtaKit tells your team when releases go out, roll out, are reverted, or fail health checks.
        It works for every release, made in the dashboard, with the CLI, from CI, or by an agent.
        Send notifications by email, to a Slack or Discord channel, or as signed webhooks to your
        own systems.
      </P>
      <P>
        Every workspace starts with one destination, “Owners and admins”. It emails owners and
        admins about auto-reverts and usage warnings. Change or turn it off like any other
        destination.
      </P>

      <Separator className="my-10" />

      <H2>Add a destination</H2>
      <P>
        In the dashboard, open <strong>Settings → Notifications</strong> and add a destination.
        Owners and admins can manage destinations.
      </P>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <strong>Email</strong> — to the workspace&apos;s owners and admins, or to chosen members.
        </li>
        <li>
          <strong>Slack</strong> — add an incoming webhook to a channel in Slack and paste its URL,
          which starts with <Code>https://hooks.slack.com/services/</Code>.
        </li>
        <li>
          <strong>Discord</strong> — in the channel settings, open Integrations → Webhooks, create
          one and paste its URL, which starts with <Code>https://discord.com/api/webhooks/</Code>.
        </li>
        <li>
          <strong>Webhook</strong> — any HTTPS endpoint. OtaKit posts the JSON payload below and
          signs every request.
        </li>
      </ul>
      <P>
        Choose the events, and optionally limit the destination to one app (usage warnings cover the
        whole workspace, so they are sent either way). Use <strong>Send test</strong> to check the
        setup; the destination&apos;s <strong>Deliveries</strong> show what was sent, the response,
        and a <strong>Redeliver</strong> button. Members who are not owners or admins see the list
        of destinations, without their URLs.
      </P>

      <Separator className="my-10" />

      <H2>Events</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <Code>release.published</Code> — a bundle is released to a channel, at 100% or as the
          start of a rollout.
        </li>
        <li>
          <Code>release.rollout_updated</Code> — a rollout moves to a new percentage or completes.
        </li>
        <li>
          <Code>release.reverted</Code> — someone reverts a release or cancels a rollout.
        </li>
        <li>
          <Code>release.auto_reverted</Code> — too many update attempts rolled back, so OtaKit
          reverted the release; see{' '}
          <Link
            href="/docs/rollouts"
            className="font-medium text-foreground underline underline-offset-4"
          >
            health and auto-revert
          </Link>{' '}
          for the thresholds.
        </li>
        <li>
          <Code>release.auto_revert_suppressed</Code> — a release is unhealthy but was not reverted,
          because the previous release on its lane was auto-reverted within 24 hours. Needs action.
        </li>
        <li>
          <Code>bundle.uploaded</Code> — a new bundle is uploaded.
        </li>
        <li>
          <Code>usage.warning</Code> — monthly downloads reach 90% or 100% of the plan.
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Payload</H2>
      <P>
        Webhooks receive a JSON body with the event <Code>id</Code>, its <Code>type</Code>, a{' '}
        <Code>timestamp</Code>, and <Code>data</Code>. Release events carry the release in the same
        shape as the REST API and MCP tools:
      </P>
      <Pre>{`{
  "id": "evt_6f1c0e8a2b7d4c9e8f0a1b2c3d4e5f60",
  "type": "release.published",
  "timestamp": "2026-10-01T12:00:00.000Z",
  "data": {
    "organization": { "id": "…", "name": "Acme" },
    "app": { "id": "…", "slug": "com.acme.app" },
    "actor": { "type": "user", "id": "…", "label": "dev@acme.com" },
    "dashboardUrl": "https://console.otakit.app/dashboard?org=…&app=…",
    "release": {
      "id": "…",
      "channel": "production",
      "runtimeVersion": "2026.10",
      "bundleId": "…",
      "bundleVersion": "1.4.2",
      "previousBundleId": "…",
      "previousBundleVersion": "1.4.1",
      "forceImmediate": false,
      "autoRevert": true,
      "autoRevertRatePercent": 20,
      "autoRevertMinSample": 50,
      "rolloutPercent": 100,
      "notes": "Faster checkout. Photo upload fixed on Android.",
      "promotedAt": "2026-10-01T12:00:00.000Z",
      "promotedBy": "dev@acme.com",
      "revertedAt": null,
      "revertedBy": null
    },
    "previousRelease": { "id": "…", "bundleVersion": "1.4.1", … }
  }
}`}</Pre>
      <P>
        Depending on the type, <Code>data</Code> also has:
      </P>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <Code>release.published</Code>: <Code>previousRelease</Code> (or <Code>null</Code> for the
          first release on a lane), and <Code>replacedRelease</Code> when it replaced an active
          rollout.
        </li>
        <li>
          <Code>release.rollout_updated</Code>: <Code>previousRolloutPercent</Code>.
        </li>
        <li>
          <Code>release.reverted</Code>: <Code>currentRelease</Code>, the release devices receive
          now, or <Code>null</Code>.
        </li>
        <li>
          <Code>release.auto_reverted</Code> and <Code>release.auto_revert_suppressed</Code>:{' '}
          <Code>health</Code> with <Code>rollbacks</Code>, <Code>attempts</Code> (applies plus
          rollbacks), <Code>rollbackSharePercent</Code>, the release&apos;s{' '}
          <Code>thresholdPercent</Code> and <Code>thresholdMinSample</Code>, and{' '}
          <Code>windowHours</Code>. Counts are events reported by devices, not unique devices.
        </li>
        <li>
          <Code>bundle.uploaded</Code>: <Code>bundle</Code> with <Code>id</Code>,{' '}
          <Code>version</Code>, <Code>runtimeVersion</Code>, <Code>size</Code> in bytes,{' '}
          <Code>strategy</Code> (<Code>zip</Code> or <Code>deltas</Code>) and <Code>createdAt</Code>
          .
        </li>
        <li>
          <Code>usage.warning</Code>: <Code>usage</Code> with <Code>threshold</Code> (90 or 100),{' '}
          <Code>downloadsCount</Code>, <Code>downloadsLimit</Code> and <Code>periodStart</Code>.{' '}
          <Code>app</Code> and <Code>actor</Code> are <Code>null</Code>.
        </li>
        <li>
          <Code>test.ping</Code>, sent by <strong>Send test</strong>: <Code>message</Code>.{' '}
          <Code>app</Code> is <Code>null</Code>.
        </li>
      </ul>
      <P>
        <Code>actor.type</Code> is <Code>user</Code> (<Code>label</Code> is the email),{' '}
        <Code>api_key</Code> (<Code>label</Code> is the key&apos;s name), or <Code>system</Code> (
        <Code>label</Code> is <Code>auto-revert</Code>, and <Code>id</Code> is <Code>null</Code>).
        New fields and event types may be added; ignore the ones you do not use.
      </P>
      <P>
        Notifications are queued with the change itself, so every committed change is reported
        exactly once per destination. Devices pick up a release once it is published to the CDN,
        normally within seconds of the notification.
      </P>

      <Separator className="my-10" />

      <H2 id="verify">Verify signatures</H2>
      <P>
        Requests follow the{' '}
        <a
          href="https://www.standardwebhooks.com"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Standard Webhooks
        </a>{' '}
        spec, so its libraries verify them. Each request has <Code>webhook-id</Code> (the
        event&apos;s <Code>id</Code>), <Code>webhook-timestamp</Code> and{' '}
        <Code>webhook-signature</Code> headers, and the user agent <Code>OtaKit-Webhooks/1.0</Code>.
        Find the signing secret (<Code>whsec_…</Code>) under{' '}
        <strong>Settings → Notifications → ⋯ → Edit → Signing secret → Reveal</strong>, and verify
        the raw request body before parsing it:
      </P>
      <Pre>{`// npm install standardwebhooks
import { Webhook } from 'standardwebhooks';

const webhook = new Webhook(process.env.OTAKIT_WEBHOOK_SECRET!);

export async function POST(request: Request) {
  const body = await request.text();
  let event: { type: string; data: any };
  try {
    event = webhook.verify(body, Object.fromEntries(request.headers)) as typeof event;
  } catch {
    return new Response('Invalid signature', { status: 401 });
  }
  if (event.type === 'release.published') {
    console.log(\`Released \${event.data.release.bundleVersion}\`);
  }
  return new Response(null, { status: 204 });
}`}</Pre>
      <Pre>{`# pip install standardwebhooks
import os
from standardwebhooks.webhooks import Webhook

webhook = Webhook(os.environ["OTAKIT_WEBHOOK_SECRET"])

# In a Flask view: raises an exception if the signature is invalid
event = webhook.verify(request.get_data(), dict(request.headers))`}</Pre>
      <P>
        The libraries also reject requests older than five minutes, which stops replays.{' '}
        <strong>Rotate secret</strong> issues a new secret; for 24 hours requests carry signatures
        for both, so you can switch without missing events.
      </P>

      <Separator className="my-10" />

      <H2>Retries and failures</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>Answer with any 2xx status within 10 seconds. Do slow work after responding.</li>
        <li>
          Other answers, timeouts and network errors are retried after 1 minute, 5 minutes, 30
          minutes, 2 hours, 5 hours, 10 hours and 10 hours, then the delivery fails.
        </li>
        <li>
          Retries and <strong>Redeliver</strong> keep the event&apos;s <Code>webhook-id</Code>; use
          it to ignore duplicates. Events can arrive out of order, so use <Code>timestamp</Code>{' '}
          when order matters.
        </li>
        <li>Redirects are not followed, and destinations must be public addresses.</li>
        <li>
          A destination is turned off at once when the endpoint says it no longer exists: a{' '}
          <Code>410 Gone</Code> answer, or a deleted Slack or Discord webhook. It is also turned off
          when every delivery has failed for three days, with no success in between. Owners and
          admins get an email either way, and the audit log records it. Fix the endpoint and turn it
          back on in Settings.
        </li>
        <li>
          Email is retried on the same schedule, and a retry only goes to the recipients who did not
          get it yet.
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Self-hosting</H2>
      <P>
        Notifications need <Code>DATA_ENCRYPTION_KEY</Code> (32 random bytes, base64) to store
        webhook secrets and <Code>RESEND_API_KEY</Code> for email. For retries, set{' '}
        <Code>CRON_SECRET</Code> and call <Code>/api/cron/notifications</Code> every minute with{' '}
        <Code>Authorization: Bearer $CRON_SECRET</Code> (or <Code>?secret=</Code>); in production
        the endpoint refuses calls when <Code>CRON_SECRET</Code> is not set. To post to services
        inside your network, set <Code>NOTIFICATIONS_ALLOW_PRIVATE_URLS=true</Code>. The{' '}
        <Link
          href="/docs/self-host"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Self-hosting
        </Link>{' '}
        guide lists every setting.
      </P>
    </>
  );
}

function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="scroll-mt-20 text-xl font-semibold tracking-tight">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-muted-foreground">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
}
