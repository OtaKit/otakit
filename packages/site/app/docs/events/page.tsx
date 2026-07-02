import Link from 'next/link';
import { Separator } from '@/components/ui/separator';
import { Pre } from '@/app/docs/CodeBlock';

export const metadata = {
  title: 'Events & Listeners',
  description:
    'Subscribe to update lifecycle events — update available, staged, applied, failed, rolled back.',
};

export default function EventsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Events &amp; Listeners</h1>
      <P>
        The plugin emits lifecycle events through the standard Capacitor listener API. Events
        complement — they don&apos;t replace — the pull APIs <Code>check()</Code> and{' '}
        <Code>getState()</Code>: listeners tell you the moment something happens while your app is
        running, and the pull APIs reconcile anything that happened while it wasn&apos;t.
      </P>
      <Pre>{`import { OtaKit } from '@otakit/capacitor-updater';

OtaKit.addListener('updateStaged', ({ bundle }) => {
  // show "Update ready — restart now?" and call OtaKit.apply() on accept
});`}</Pre>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">Event reference</h2>
      <div className="mt-4 space-y-3">
        <EventRow
          event="updateAvailable"
          payload="LatestVersion"
          description="A check found a newer bundle, before any download starts. Fires on manual check() and at the start of automatic flows."
        />
        <EventRow
          event="updateStaged"
          payload="{ bundle: BundleInfo }"
          description="A bundle was downloaded, verified, and staged, ready to apply. Download and stage are atomic in OtaKit, so this is the single 'downloaded' event."
        />
        <EventRow
          event="updateApplied"
          payload="{ bundle: BundleInfo }"
          description="A newly activated bundle was confirmed healthy — fires when notifyAppReady() confirms the trial bundle, in the reloaded JS context."
        />
        <EventRow
          event="downloadFailed"
          payload="{ version, runtimeVersion?, releaseId?, channel?, reason }"
          description="A download, verification, or extraction failed. Non-terminal: the app keeps running its current bundle and retries on a later cycle."
        />
        <EventRow
          event="rollback"
          payload="{ version, runtimeVersion?, releaseId?, channel?, reason }"
          description="An applied bundle failed its health check (notifyAppReady timeout) and was reverted to the previous bundle."
        />
      </div>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">Caveats</h2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <strong>Events fire only while the app process is alive.</strong> Nothing is delivered for
          work that happened while the app was killed or before your listener attached — there is no
          buffering or replay.
        </li>
        <li>
          <strong>
            Reconcile with <Code>getState()</Code> and <Code>getLastFailure()</Code> on startup.
          </strong>{' '}
          A bundle staged in a previous session shows up in <Code>getState().staged</Code>, and a
          startup rollback (the app restarted before <Code>notifyAppReady()</Code>) happens before
          any JS runs, so it can only be observed via <Code>getLastFailure()</Code>.
        </li>
        <li>
          <strong>
            <Code>apply()</Code> destroys the old JS context.
          </strong>{' '}
          A listener registered before the restart will not see <Code>updateApplied</Code> — that
          event fires in the reloaded bundle. Attach <Code>updateApplied</Code> and{' '}
          <Code>rollback</Code> listeners early in app startup, not inside the restart click
          handler.
        </li>
        <li>
          <strong>
            One <Code>updateStaged</Code>, no separate &quot;downloaded&quot; event.
          </strong>{' '}
          Download, hash verification, and staging are one atomic operation.
        </li>
      </ul>
      <P>The apply timeline, end to end:</P>
      <Pre>{`updateStaged            (old context)
  -> user taps "Restart"
  -> OtaKit.apply()      (old JS context ends here; WebView reloads)
  -> new bundle boots
  -> app calls notifyAppReady()
  -> updateApplied       (NEW context - attach this listener at startup)`}</Pre>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">Use cases</h2>

      <H3>Auto-download in the background, prompt to apply</H3>
      <P>
        Let <Code>shadow</Code> mode do the background checking, downloading, throttling, and
        deduplication for you, and only handle the prompt yourself:
      </P>
      <Pre>{`// capacitor.config.ts
plugins: {
  OtaKit: { launchPolicy: 'shadow', resumePolicy: 'shadow' }
}`}</Pre>
      <Pre>{`// app startup
const state = await OtaKit.getState();
if (state.staged) showRestartPrompt(state.staged);
OtaKit.addListener('updateStaged', ({ bundle }) => showRestartPrompt(bundle));

// in the prompt's accept handler
await OtaKit.apply();`}</Pre>

      <H3>Prompt before downloading</H3>
      <P>
        Gate the download itself (for users on metered connections) by pairing manual mode with{' '}
        <Code>updateAvailable</Code>:
      </P>
      <Pre>{`// capacitor.config.ts: { launchPolicy: 'off', resumePolicy: 'off' }
OtaKit.addListener('updateAvailable', async (latest) => {
  if (await confirmDownload(latest.version)) {
    await OtaKit.download(); // emits updateStaged when done
  }
});
await OtaKit.check();`}</Pre>

      <H3>Post-update toast and failure reporting</H3>
      <Pre>{`// attach at startup, in the reloaded bundle
OtaKit.addListener('updateApplied', ({ bundle }) => {
  toast('Updated to ' + bundle.version);
});
OtaKit.addListener('downloadFailed', (e) => reportError('ota_download', e));
OtaKit.addListener('rollback', (e) => reportError('ota_rollback', e));

// startup rollbacks can't reach a listener - reconcile:
const failure = await OtaKit.getLastFailure();
if (failure) reportError('ota_rollback_startup', failure);`}</Pre>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">Cleanup</h2>
      <P>
        <Code>addListener</Code> resolves to a <Code>PluginListenerHandle</Code>; call{' '}
        <Code>.remove()</Code> on it when the owning UI unmounts, or{' '}
        <Code>OtaKit.removeAllListeners()</Code> to drop everything at once.
      </P>

      <Separator className="my-10" />

      <P>
        Also see{' '}
        <Link
          href="/docs/update-strategies"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Update Strategies
        </Link>{' '}
        for choosing the policies these events observe, and the{' '}
        <Link
          href="/docs/plugin"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Plugin API
        </Link>{' '}
        reference for the full method list.
      </P>
    </>
  );
}

function EventRow({
  event,
  payload,
  description,
}: {
  event: string;
  payload: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="font-mono text-sm">
        {event} <span className="text-muted-foreground">({payload})</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
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
