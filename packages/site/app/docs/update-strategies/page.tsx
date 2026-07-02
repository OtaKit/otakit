import Link from 'next/link';
import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Update Strategies',
  description:
    'How launchPolicy, resumePolicy, and runtimePolicy combine to control when updates apply.',
};

export default function UpdateStrategiesPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Update Strategies</h1>
      <P>
        OtaKit has one set of four policy values and three settings that decide when each one runs.
        The values — <Code>off</Code>, <Code>shadow</Code>, <Code>apply-staged</Code>, and{' '}
        <Code>immediate</Code> — describe what happens. <Code>launchPolicy</Code>,{' '}
        <Code>resumePolicy</Code>, and <Code>runtimePolicy</Code> describe when it happens. This
        guide walks through picking a combination; for the full field list see the{' '}
        <Link
          href="/docs/plugin"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Plugin API
        </Link>{' '}
        reference.
      </P>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">The four policy values</h2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <strong>off</strong> — do nothing automatically. Nothing is checked, staged, or applied.
        </li>
        <li>
          <strong>shadow</strong> — check for the latest update and stage it locally, but never
          apply it. The current session keeps running on the bundle it already has.
        </li>
        <li>
          <strong>apply-staged</strong> — apply a bundle if one is already staged. If nothing is
          staged, it falls back to shadow behavior for that check.
        </li>
        <li>
          <strong>immediate</strong> — check, stage, and apply the newest bundle right away when one
          is available. The reload can land mid-session — and since any release can be escalated
          with <Code>--force-immediate</Code>, you rarely need this as the launch or resume default.
        </li>
      </ul>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">When each setting runs</h2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <strong>
            <Code>launchPolicy</Code>
          </strong>{' '}
          — every normal cold start, once the app&apos;s runtime lane is already resolved. This is
          the one most apps tune, since it covers the vast majority of app opens. Default:{' '}
          <Code>apply-staged</Code>.
        </li>
        <li>
          <strong>
            <Code>resumePolicy</Code>
          </strong>{' '}
          — when the app returns to the foreground from the background, throttled by{' '}
          <Code>checkInterval</Code>. Default: <Code>shadow</Code>.
        </li>
        <li>
          <strong>
            <Code>runtimePolicy</Code>
          </strong>{' '}
          — cold start specifically when <Code>runtimeVersion</Code> changes or resolves for the
          first time. In practice that&apos;s the app&apos;s first native install, or a native
          update where you bumped <Code>runtimeVersion</Code> in the plugin config before that
          release. Default: <Code>immediate</Code>, so a fresh runtime lane catches up fast instead
          of waiting on a bundle staged under the old lane.
        </li>
      </ul>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">Recommended combinations</h2>

      <H3>Hosted default — right for most apps</H3>
      <P>
        <Code>runtimePolicy: &quot;immediate&quot;</Code>,{' '}
        <Code>launchPolicy: &quot;apply-staged&quot;</Code>,{' '}
        <Code>resumePolicy: &quot;shadow&quot;</Code>. Fast on first install, seamless between
        launches, and new bundles are ready to go as soon as a session restarts.
      </P>

      <H3>Update quietly, reload only with consent</H3>
      <P>
        Set <Code>launchPolicy</Code> and <Code>resumePolicy</Code> to <Code>shadow</Code>. Bundles
        stage in the background and nothing ever activates on its own — show a &quot;restart to
        update&quot; prompt from the <Code>updateStaged</Code> event and call <Code>apply()</Code>{' '}
        on accept (see{' '}
        <Link
          href="/docs/events"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Events &amp; Listeners
        </Link>
        ).
      </P>

      <H3>Full manual control</H3>
      <P>
        Turn all three policies <Code>off</Code> and drive the lifecycle yourself with{' '}
        <Code>check()</Code>, <Code>download()</Code>, and <Code>apply()</Code>. Use this when your
        app owns the entire update experience — see the Manual Flow section of the{' '}
        <Link
          href="/docs/plugin"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Plugin API
        </Link>{' '}
        reference.
      </P>

      <H3>Ship critical fixes instantly</H3>
      <P>
        This one isn&apos;t a config — it&apos;s per release. Mark it{' '}
        <strong>force immediate</strong> in the dashboard&apos;s release dialog or with{' '}
        <Code>otakit release --force-immediate</Code>: the flag is baked into the signed manifest,
        and devices on <Code>shadow</Code> or <Code>apply-staged</Code> escalate that one release to
        immediate — download, apply, and reload on their next check. No rebuild, no config change.
      </P>
      <P>
        It&apos;s &quot;immediate on the next check&quot;, not push, and the trial/rollback safety
        net still applies. Policies set to <Code>off</Code> never fetch a manifest, so they never
        see the flag. Because the reload can land mid-session, reserve it for broken releases — not
        routine rollouts.
      </P>

      <Separator className="my-10" />

      <P>
        Also see{' '}
        <Link
          href="/docs/channels"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Channels &amp; Runtime Version
        </Link>{' '}
        for how rollout audience and native compatibility lanes interact with these policies.
      </P>
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
