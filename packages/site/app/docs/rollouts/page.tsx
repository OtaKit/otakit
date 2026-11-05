import Link from 'next/link';

import { Separator } from '@/components/ui/separator';
import { Pre } from '@/app/docs/CodeBlock';

export const metadata = {
  title: 'Percentage Rollouts',
  description:
    'Release a bundle to a share of devices first, watch its health, then raise the share or complete it.',
};

export default function RolloutsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Percentage Rollouts</h1>
      <P>
        Release a bundle to a share of devices first — for example 10% of production — check its
        health, then raise the share or complete the rollout. If it misbehaves, cancel it and every
        device returns to the previous release.
      </P>
      <P>
        Rollouts need <Code>@otakit/capacitor-updater</Code> 3.1 or later on the device. Channels
        choose <em>who</em> gets a release (testers, beta, production); rollouts choose{' '}
        <em>how many</em> of them get it.
      </P>

      <Separator className="my-10" />

      <H2>How devices are selected</H2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Each installation keeps a random secret that never leaves the device. For every rollout it
          derives a number from 1 to 100 and takes the rolling release when that number is within
          the percentage.
        </li>
        <li>
          The number stays the same for the whole rollout. Raising 10% to 25% adds devices; lowering
          it moves the extra devices back to the previous release after their next check. A device
          that already downloaded the rolling bundle may run it once more before switching back,
          which also applies when a rollout is cancelled.
        </li>
        <li>Each rollout draws new numbers, so the same devices are not always first.</li>
        <li>
          No device identifiers are collected. The percentage and the rolling release are part of
          the signed manifest.
        </li>
        <li>
          Devices on plugin versions before 3.1 ignore rollouts and stay on the previous release
          until the rollout completes.
        </li>
        <li>
          The first release on a channel goes to every device, since there is nothing to fall back
          to.
        </li>
      </ul>

      <Separator className="my-10" />

      <H2>Start a rollout</H2>
      <P>
        Pass <Code>--rollout</Code> when you release. In the dashboard, choose the share under{' '}
        <strong>Roll out to</strong> in the release dialog.
      </P>
      <Pre>{`# Upload and release to 10% of production
otakit upload --release production --rollout 10

# Or roll out a bundle you already uploaded
otakit release <bundle-id> --channel production --rollout 10`}</Pre>

      <Separator className="my-10" />

      <H2>Raise, complete, or cancel</H2>
      <Pre>{`otakit rollout                                    # show active rollouts
otakit rollout --channel production --percent 50  # raise or lower the share
otakit rollout --channel production --complete    # every device gets it
otakit rollout --channel production --cancel      # everyone returns to the previous release`}</Pre>
      <P>
        In the dashboard, open the channel badge of the rolling bundle for{' '}
        <strong>Change percentage</strong>, <strong>Complete rollout</strong>, and{' '}
        <strong>Cancel rollout</strong>. A completed rollout is final; to undo it, revert the
        release.
      </P>

      <Separator className="my-10" />

      <H2>Releasing during a rollout</H2>
      <P>
        A channel has one rollout at a time. Releasing another bundle while one is rolling out is
        refused, so a rollout is never replaced by accident. Complete or cancel it first, or pass{' '}
        <Code>--replace-rollout</Code> to cancel it and release the new bundle in its place:
      </P>
      <Pre>{`otakit upload --release production --replace-rollout --rollout 10`}</Pre>

      <Separator className="my-10" />

      <H2>Health and auto-revert</H2>
      <P>
        Devices on the rolling release report events with its own release ID, so its health counts
        only those devices. Auto-revert works on rolling releases and returns every device to the
        previous release. At low percentages it takes longer to reach the minimum sample, so small
        apps should start at 5% or more.
      </P>
      <P>
        To watch a rollout over time, open the release&apos;s channel badge and choose{' '}
        <strong>Health</strong>. It charts applies, rollbacks and download errors per hour or day,
        marks each rollout step, and shows the lane&apos;s releases replacing each other. Agents
        read the same data with <Code>get_release_timeseries</Code>.
      </P>

      <Separator className="my-10" />

      <H2>On the device</H2>
      <P>
        <Code>getState().rollout</Code> shows what the last check saw, which helps when testing a
        rollout on a phone:
      </P>
      <Pre>{`const { rollout } = await OtaKit.getState();
// { releaseId, version, percent: 10, bucket: 57, included: false }, or null`}</Pre>

      <Separator className="my-10" />

      <H2>API and agents</H2>
      <P>
        The REST API takes <Code>rolloutPercent</Code> and <Code>replaceRollout</Code> when
        releasing and has an endpoint to change the percentage; see the{' '}
        <Link href="/docs/api" className="font-medium text-foreground underline underline-offset-4">
          REST API
        </Link>
        . Agents use <Code>publish_release</Code> with <Code>rolloutPercent</Code> and{' '}
        <Code>set_rollout_percent</Code>; see{' '}
        <Link
          href="/docs/agents"
          className="font-medium text-foreground underline underline-offset-4"
        >
          MCP &amp; Agent Skills
        </Link>
        .
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
