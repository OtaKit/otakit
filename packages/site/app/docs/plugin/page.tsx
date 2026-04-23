import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Plugin API — OtaKit Docs',
  description: 'Capacitor plugin setup, policy-based automatic updates, and manual advanced flows.',
};

export default function PluginReferencePage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Plugin API</h1>
      <P>
        Import from <Code>@otakit/capacitor-updater</Code>. The default flow usually only needs{' '}
        <Code>notifyAppReady()</Code>. The other public methods exist for advanced manual update
        flows where your app decides when to check, download, and apply an update.
      </P>
      <Pre>{`import { OtaKit } from "@otakit/capacitor-updater";`}</Pre>

      <Separator className="my-10" />

      <H2>Configuration</H2>
      <P>
        Hosted OtaKit keeps the config small. The default automatic behavior is runtime catch-up on
        cold start, staged activation on later cold starts, and background checks on resume.
      </P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    // Optional:
    // channel: "production",
    // runtimeVersion: "2026.04",
    // launchPolicy: "apply-staged",
    // resumePolicy: "shadow",
    // runtimePolicy: "immediate",
    // checkInterval: 600000,
  }
}`}</Pre>
      <div className="mt-4 overflow-x-auto rounded-lg border text-xs">
        <ConfigRow
          field="appId"
          type="string"
          description="OtaKit app ID for manifest fetches and event ingest."
        />
        <ConfigRow
          field="channel"
          type="string"
          description="Named release track to check. Omit it to use the base channel."
        />
        <ConfigRow
          field="runtimeVersion"
          type="string"
          description="Optional native compatibility lane. Set it when a new store build must stop receiving older OTA bundles."
        />
        <ConfigRow
          field="launchPolicy"
          type='"off" | "shadow" | "apply-staged" | "immediate"'
          description="Cold-start policy after the current runtime lane is already resolved. Default: apply-staged."
        />
        <ConfigRow
          field="resumePolicy"
          type='"off" | "shadow" | "apply-staged" | "immediate"'
          description="Foreground resume policy. Default: shadow."
        />
        <ConfigRow
          field="runtimePolicy"
          type='"off" | "shadow" | "apply-staged" | "immediate"'
          description="Cold-start policy used when runtimeVersion changes or resolves for the first time. Default: immediate."
        />
        <ConfigRow
          field="checkInterval"
          type="number"
          description='Milliseconds between automatic background resume checks. Applies to `resumePolicy: "shadow"` and `resumePolicy: "apply-staged"` when no staged bundle is already waiting. Default: 600000. Set to 0 or a negative value to disable resume throttling.'
        />
        <ConfigRow
          field="appReadyTimeout"
          type="number"
          description="Milliseconds to wait for notifyAppReady(). Default: 10000."
        />
        <ConfigRow
          field="cdnUrl"
          type="string"
          description="Optional CDN base URL for static manifest and bundle delivery. Leave unset for the hosted default."
        />
        <ConfigRow
          field="ingestUrl"
          type="string"
          description="Optional event ingest base URL. Leave unset for the hosted default."
        />
        <ConfigRow
          field="serverUrl"
          type="string"
          description="Optional control-plane API base URL used by self-host tooling such as the CLI. The native runtime uses cdnUrl and ingestUrl instead."
        />
        <ConfigRow
          field="manifestKeys"
          type="array"
          description="Optional public verification keys for custom or self-hosted manifest signing."
        />
        <ConfigRow
          field="allowInsecureUrls"
          type="boolean"
          description="Allow HTTP only for localhost development. Default: false."
          last
        />
      </div>

      <P>
        Hosted OtaKit points at the managed CDN and ingest service automatically. Do not set{' '}
        <Code>cdnUrl</Code>, <Code>ingestUrl</Code>, or <Code>manifestKeys</Code> unless you
        intentionally want custom hosting or verification behavior.
      </P>

      <Separator className="my-10" />

      <H2>Policies</H2>
      <P>
        Policies are the only automatic behaviors. The same policy logic runs no matter which event
        triggered it. <Code>launchPolicy</Code>, <Code>resumePolicy</Code>, and{' '}
        <Code>runtimePolicy</Code> only decide when to invoke that policy.
      </P>
      <div className="mt-4 overflow-x-auto rounded-lg border text-xs">
        <ConfigRow field="off" type="policy" description="Do nothing automatically." />
        <ConfigRow
          field="shadow"
          type="policy"
          description="Check for the latest update and stage it locally, but never apply it in that flow."
        />
        <ConfigRow
          field="apply-staged"
          type="policy"
          description="Apply an already staged bundle if one exists. If nothing is staged, fall back to shadow."
        />
        <ConfigRow
          field="immediate"
          type="policy"
          description="Check, stage, and immediately apply the newest update when one is available."
          last
        />
      </div>
      <P>
        The hosted defaults are usually the right production baseline:{' '}
        <Code>runtimePolicy: &quot;immediate&quot;</Code>,{' '}
        <Code>launchPolicy: &quot;apply-staged&quot;</Code>, and{' '}
        <Code>resumePolicy: &quot;shadow&quot;</Code>.
      </P>

      <Separator className="my-10" />

      <H2>Compatibility lanes</H2>
      <P>
        <Code>channel</Code> is for rollout audience. <Code>runtimeVersion</Code> is for native
        compatibility.
      </P>
      <P>
        If you ship a new store build and do not want it to keep consuming older OTA bundles, bump{' '}
        <Code>runtimeVersion</Code> in the plugin config before uploading the next OTA bundle.
      </P>
      <P>
        The CLI reads that same value automatically during upload, so releases stay inside the
        correct runtime lane without extra flags.
      </P>
      <P>
        When <Code>runtimeVersion</Code> changes, or when the app resolves a runtime lane for the
        first time, OtaKit runs <Code>runtimePolicy</Code> on cold start. By default that policy is{' '}
        <Code>immediate</Code>, so fresh installs and new native shells catch up before that lane is
        marked resolved.
      </P>

      <Separator className="my-10" />

      <H2>Automatic Flow (Default)</H2>
      <P>The hosted default is equivalent to this configuration:</P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    runtimePolicy: "immediate",
    launchPolicy: "apply-staged",
    resumePolicy: "shadow",
    appReadyTimeout: 10000,
  }
}`}</Pre>
      <P>
        In this mode, your app code usually only needs to call <Code>notifyAppReady()</Code>.
      </P>
      <P>
        Resume throttling is intentionally narrow: <Code>checkInterval</Code> only affects resume
        background checks. Cold-start runtime handling, cold-start launch handling, and all manual
        APIs always act immediately.
      </P>
      <P>
        Set <Code>checkInterval</Code> to <Code>0</Code> or a negative value if you want resume
        checks to run every time instead of being throttled.
      </P>
      <div className="mt-4 space-y-4">
        <Method
          name="notifyAppReady()"
          returns="void"
          description="Confirm the current bundle is working. Call this once when your app has fully loaded. If it is not called within appReadyTimeout, the plugin rolls back."
        />
      </div>
      <Pre>{`import { OtaKit } from "@otakit/capacitor-updater";

await OtaKit.notifyAppReady();`}</Pre>

      <Separator className="my-10" />

      <H2>Manual Flow (Advanced)</H2>
      <P>
        If you want no automatic checks at all, turn every automatic policy off and drive the update
        lifecycle yourself.
      </P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    launchPolicy: "off",
    resumePolicy: "off",
    runtimePolicy: "off",
  }
}`}</Pre>
      <div className="mt-4 space-y-4">
        <Method
          name="getState()"
          returns="OtaKitState"
          description="Inspect the current updater state: current bundle, fallback bundle, staged bundle, and builtin version."
        />
        <Method
          name="check()"
          returns="CheckResult"
          description="Check the configured channel for a newer bundle without downloading it. Returns no_update, already_staged, or update_available."
        />
        <Method
          name="download()"
          returns="DownloadResult"
          description="Ensure the latest bundle is staged for later activation. Returns no_update or staged."
        />
        <Method
          name="update()"
          returns="void"
          description="Convenience helper for manual flows. It runs the same native immediate-flow operation used by automatic immediate policies. Terminal operation: if an update is applied, it does not resolve back into the old JS context."
        />
        <Method
          name="apply()"
          returns="void"
          description="Activate the currently staged bundle and reload the WebView. Terminal operation: on success it does not resolve back into the old JS context."
        />
        <Method
          name="notifyAppReady()"
          returns="void"
          description="Still required after the updated bundle launches. Call this once when your app has fully loaded so the plugin can mark the new bundle healthy."
        />
        <Method
          name="getLastFailure()"
          returns="BundleInfo | null"
          description="Returns information about the most recent failed update (rollback). Useful for diagnostics and crash reporting. Returns null if no failure has occurred."
        />
      </div>
      <P>
        There is no listener API in the current plugin surface. If you want custom update UI, use{' '}
        <Code>check()</Code>, <Code>getState()</Code>, <Code>download()</Code>, and{' '}
        <Code>apply()</Code> directly.
      </P>
      <P>
        After a successful <Code>apply()</Code> or an <Code>update()</Code> that installs a new
        bundle, the app reloads immediately. Call <Code>notifyAppReady()</Code> from the reloaded
        app startup, not in the same JS flow that triggered the activation.
      </P>
      <P>
        The simplest manual pattern is: check for updates, show your own prompt, then call{' '}
        <Code>update()</Code> if the user accepts.
      </P>
      <Pre>{`const latest = await OtaKit.check();

if (latest.kind === "no_update") {
  return;
}

const accepted = window.confirm("Update available. Install now?");

if (accepted) {
  await OtaKit.update();
}`}</Pre>
      <P>If you want a split flow, download first and apply later:</P>
      <Pre>{`const state = await OtaKit.getState();

if (state.staged) {
  await OtaKit.apply();
  return;
}

const latest = await OtaKit.check();
if (latest.kind === "no_update") {
  return;
}

const accepted = window.confirm("Update available. Download now?");
if (!accepted) {
  return;
}

const result = await OtaKit.download();
if (result.kind === "no_update") {
  return;
}

// Later, after another user action:
await OtaKit.apply();`}</Pre>

      <Separator className="my-10" />

      <H2>Advanced Overrides</H2>
      <P>Use these only when you run a custom server or need custom verification behavior.</P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    // Optional advanced overrides
    // cdnUrl: "https://cdn.your-domain.com",
    // ingestUrl: "https://ingest.your-domain.com/v1",
    // serverUrl: "https://your-domain.com/api/v1",
    // allowInsecureUrls: false,
    // manifestKeys: [
    //   { kid: "key-2026-01", key: "MFkwEwYH..." }
    // ]
  }
}`}</Pre>
      <div className="mt-4 overflow-x-auto rounded-lg border text-xs">
        <ConfigRow
          field="cdnUrl"
          type="string"
          description="Custom CDN base URL for static manifest and bundle delivery."
        />
        <ConfigRow
          field="ingestUrl"
          type="string"
          description="Custom event ingest base URL used for device telemetry."
        />
        <ConfigRow
          field="serverUrl"
          type="string"
          description="Control-plane API URL used by self-host tooling such as the CLI. The native runtime does not read it."
        />
        <ConfigRow
          field="allowInsecureUrls"
          type="boolean"
          description="Allow HTTP for localhost development only. Default: false."
        />
        <ConfigRow
          field="manifestKeys"
          type="array"
          description="Public verification keys for manifest signature verification on custom/self-hosted setups."
          last
        />
      </div>

      <Separator className="my-10" />

      <H2>Types</H2>
      <Pre>{`type OtaKitPolicy = "off" | "shadow" | "apply-staged" | "immediate";

interface BundleInfo {
  id: string;
  version: string;
  runtimeVersion?: string;
  status: "builtin" | "pending" | "trial" | "success" | "error";
  downloadedAt?: string;
  sha256?: string;
  channel?: string;
  releaseId?: string;
}

interface OtaKitState {
  current: BundleInfo;
  fallback: BundleInfo;
  staged: BundleInfo | null;
  builtinVersion: string;
}

interface LatestVersion {
  version: string;
  runtimeVersion?: string;
  url: string;
  sha256: string;
  size: number;
  releaseId: string;
}

type CheckResult =
  | { kind: "no_update" }
  | { kind: "already_staged"; latest: LatestVersion }
  | { kind: "update_available"; latest: LatestVersion };

type DownloadResult =
  | { kind: "no_update" }
  | { kind: "staged"; bundle: BundleInfo };`}</Pre>
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

function Method({
  name,
  returns,
  description,
}: {
  name: string;
  returns: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="font-mono text-sm">
        {name} <span className="text-muted-foreground">→ {returns}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function ConfigRow({
  field,
  type,
  description,
  last = false,
}: {
  field: string;
  type: string;
  description: string;
  last?: boolean;
}) {
  return (
    <div
      className={`grid min-w-[640px] grid-cols-[180px_140px_1fr] gap-0 ${last ? '' : 'border-b'}`}
    >
      <div className="border-r px-3 py-2 font-mono">{field}</div>
      <div className="border-r px-3 py-2 text-muted-foreground">{type}</div>
      <div className="px-3 py-2 text-muted-foreground">{description}</div>
    </div>
  );
}
