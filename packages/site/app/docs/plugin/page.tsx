import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Plugin API — OtaKit Docs',
  description: 'Capacitor plugin setup, default automatic updates, and manual advanced flows.',
};

export default function PluginReferencePage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Plugin API</h1>
      <P>
        Import from <Code>@otakit/capacitor-updater</Code>. The normal flow usually only needs{' '}
        <Code>notifyAppReady()</Code>. The other public methods exist for advanced manual update
        flows where your app decides when to check, download, and apply an update.
      </P>
      <Pre>{`import { OtaKit } from "@otakit/capacitor-updater";`}</Pre>

      <Separator className="my-10" />

      <H2>Configuration</H2>
      <P>For hosted OtaKit, keep the plugin config small:</P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    appReadyTimeout: 10000,
    // Optional:
    // channel: "production",
    // runtimeVersion: "2026.04",
    // updateMode: "next-resume",
    // immediateUpdateOnRuntimeChange: true,
    // autoSplashscreen: true,
    // autoSplashscreenTimeout: 8000,
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
          field="updateMode"
          type="'manual' | 'next-launch' | 'next-resume' | 'immediate'"
          description="Overall update behavior. Optional, defaults to next-launch."
        />
        <ConfigRow
          field="immediateUpdateOnRuntimeChange"
          type="boolean"
          description="One-time cold-start override for fresh installs or runtimeVersion changes. In next-launch/next-resume, it checks live, bypasses checkInterval, and applies immediately if needed."
        />
        <ConfigRow
          field="checkInterval"
          type="number"
          description="Milliseconds between automatic checks in next-launch and next-resume. Manual APIs and immediate mode ignore it. Optional, defaults to 600000 (10 min)."
        />
        <ConfigRow
          field="appReadyTimeout"
          type="number"
          description="Milliseconds to wait for notifyAppReady(). Optional, defaults to 10000."
        />
        <ConfigRow
          field="autoSplashscreen"
          type="boolean"
          description="Optional cold-start launch splash handoff for inline update launches. Requires @capacitor/splash-screen, SplashScreen.launchAutoHide = false, and a reliable notifyAppReady() call."
        />
        <ConfigRow
          field="autoSplashscreenTimeout"
          type="number"
          description="Milliseconds to keep the launch splash visible while OtaKit decides whether to apply an inline cold-start update. Optional, defaults to 10000."
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
          last
        />
      </div>

      <P>
        Hosted OtaKit points at the managed CDN and ingest service automatically. Do not set{' '}
        <Code>cdnUrl</Code>, <Code>ingestUrl</Code>, or <Code>manifestKeys</Code> unless you
        intentionally want custom hosting or verification behavior.
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
        The CLI reads that same value automatically during upload, so releases stay simple: release
        the bundle and it naturally stays inside its own runtime lane.
      </P>
      <P>
        If you want fresh installs or new native shells to catch up on first launch, enable{' '}
        <Code>immediateUpdateOnRuntimeChange</Code>. That override is launch-only: it bypasses{' '}
        <Code>checkInterval</Code>, performs a live check for the current runtime lane, and then
        returns to the normal update mode after the lane is resolved.
      </P>

      <Separator className="my-10" />

      <H2>Launch Splash Handoff</H2>
      <P>
        If you want to mask the old-bundle flash during cold-start inline updates, enable{' '}
        <Code>autoSplashscreen</Code>. OtaKit then owns the existing Capacitor launch splash only
        for cold-start inline update launches.
      </P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    updateMode: "immediate",
    autoSplashscreen: true,
    autoSplashscreenTimeout: 8000,
  }
}`}</Pre>
      <P>Hard prerequisites:</P>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          Install <Code>@capacitor/splash-screen</Code>.
        </li>
        <li>
          Set <Code>SplashScreen.launchAutoHide</Code> to <Code>false</Code>.
        </li>
        <li>
          Call <Code>notifyAppReady()</Code> reliably after startup.
        </li>
      </ul>
      <P>
        Scope is intentionally narrow in v1: cold start only. Resume activations keep their normal
        behavior, and manual update flows do not use this feature.
      </P>
      <P>
        If <Code>autoSplashscreenTimeout</Code> fires, OtaKit hides the splash and does not apply
        inline later on that same cold start. If the download finishes after that, the bundle stays
        staged for the next normal activation path.
      </P>

      <Separator className="my-10" />

      <H2>Update Modes</H2>
      <P>
        <Code>next-launch</Code> and <Code>next-resume</Code> check on cold start and app resume,
        throttled by <Code>checkInterval</Code>. <Code>immediate</Code> ignores the interval, and
        manual APIs always perform a live check.
      </P>
      <P>
        <Code>immediateUpdateOnRuntimeChange</Code> only augments automatic <Code>next-launch</Code>{' '}
        and <Code>next-resume</Code>. It is ignored in <Code>manual</Code> and redundant in{' '}
        <Code>immediate</Code>.
      </P>
      <div className="mt-4 overflow-x-auto rounded-lg border text-xs">
        <ConfigRow
          field="next-launch"
          type="default"
          description="Check and download in the background. Activate the staged bundle only on the next cold start. Zero disruption during a session."
        />
        <ConfigRow
          field="next-resume"
          type="recommended"
          description="Check and download in the background. Activate the staged bundle on the next resume or cold start. Brief reload when returning to the app."
        />
        <ConfigRow
          field="immediate"
          type="development"
          description="Check, download, and activate as soon as possible on both cold start and resume. Primarily for development and testing."
        />
        <ConfigRow
          field="manual"
          type="optional"
          description="No automatic checks. Your app drives everything via check(), download(), apply(), and update()."
          last
        />
      </div>

      <Separator className="my-10" />

      <H2>Manifest Verification</H2>
      <P>
        Hosted OtaKit verifies manifests automatically. The native plugin ships with built-in
        trusted public keys for the managed service and uses them by default when you stay on the
        hosted CDN.
      </P>
      <P>
        You only need <Code>manifestKeys</Code> when you intentionally override trust for a custom
        or self-hosted setup. In that case, set <Code>cdnUrl</Code> to your manifest CDN and{' '}
        <Code>ingestUrl</Code> to your own event ingest base URL.
      </P>

      <Separator className="my-10" />

      <H2>Automatic Flow (Default)</H2>
      <P>
        This is the normal OtaKit flow. Leave <Code>updateMode</Code> unset or set it to{' '}
        <Code>next-launch</Code>. The plugin checks automatically on startup, downloads in the
        background, and activates the new bundle according to the selected update mode.
      </P>
      <P>
        In this mode, your app code usually only needs to call <Code>notifyAppReady()</Code>.
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
        Use this only when your app wants to control the update UX itself, for example by showing an
        “Update available” prompt or delaying install until the user confirms. Set{' '}
        <Code>updateMode</Code> to <Code>&quot;manual&quot;</Code> first.
      </P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    updateMode: "manual",
    appReadyTimeout: 10000,
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
          returns="LatestVersion | null"
          description="Check the configured channel for a newer bundle without downloading it. When downloaded=true, that exact update is already staged locally."
        />
        <Method
          name="download()"
          returns="BundleInfo | null"
          description="Ensure the latest bundle is staged for later activation. If it is already staged, the staged bundle is returned without re-downloading it."
        />
        <Method
          name="update()"
          returns="void"
          description="Recommended one-shot manual helper. Bring the app to the newest available update now. If the newest update is already staged, apply it. Otherwise download it and apply it. Terminal operation."
        />
        <Method
          name="apply()"
          returns="void"
          description="Activate the currently staged bundle and reload the WebView. Terminal operation."
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
        The simplest manual pattern is: check for updates, show your own prompt, then call{' '}
        <Code>update()</Code> if the user accepts.
      </P>
      <P>
        If <Code>check()</Code> returns <Code>downloaded: true</Code>, the latest update is already
        staged locally and you can call <Code>apply()</Code> directly.
      </P>
      <Pre>{`const latest = await OtaKit.check();

if (!latest) {
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
if (!latest) {
  return;
}

const accepted = window.confirm("Update available. Download now?");
if (!accepted) {
  return;
}

await OtaKit.download();

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
          description="Custom event ingest base URL used for plugin event writes."
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

      <H2>Events</H2>
      <P>
        Listen to update lifecycle events with <Code>OtaKit.addListener(event, callback)</Code>.
        Returns a handle that can be removed with <Code>.remove()</Code>.
      </P>
      <div className="mt-4 overflow-x-auto rounded-lg border text-xs">
        <EventRow
          event="downloadStarted"
          payload="{ version }"
          description="A download has begun"
        />
        <EventRow
          event="downloadComplete"
          payload="BundleInfo"
          description="Download finished and bundle staged"
        />
        <EventRow
          event="downloadFailed"
          payload="{ version, error }"
          description="Download failed"
        />
        <EventRow
          event="updateAvailable"
          payload="LatestVersion"
          description="A newer bundle is available. downloaded=true means it is already staged locally."
        />
        <EventRow event="noUpdateAvailable" payload="" description="App is up to date" />
        <EventRow
          event="appReady"
          payload="BundleInfo"
          description="A newly activated OTA bundle was confirmed healthy by notifyAppReady()."
        />
        <EventRow
          event="rollback"
          payload="{ from, to, reason }"
          description="The running bundle rolled back to fallback or builtin"
          last
        />
      </div>
      <Pre>{`OtaKit.addListener("downloadComplete", (bundle) => {
  console.log(\`Update staged: \${bundle.version}\`);
});

await OtaKit.removeAllListeners();`}</Pre>

      <Separator className="my-10" />

      <H2>Types</H2>
      <Pre>{`interface BundleInfo {
  id: string;
  version: string;
  runtimeVersion?: string;
  status: "builtin" | "pending"
    | "trial" | "success" | "error";
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
  url: string;
  sha256: string;
  size: number;
  runtimeVersion?: string;
  downloaded?: boolean;
  releaseId?: string;
}`}</Pre>
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

function EventRow({
  event,
  payload,
  description,
  last = false,
}: {
  event: string;
  payload: string;
  description: string;
  last?: boolean;
}) {
  return (
    <div
      className={`grid min-w-[640px] grid-cols-[180px_180px_1fr] gap-0 ${last ? '' : 'border-b'}`}
    >
      <div className="border-r px-3 py-2 font-mono">{event}</div>
      <div className="border-r px-3 py-2 text-muted-foreground">{payload || '—'}</div>
      <div className="px-3 py-2 text-muted-foreground">{description}</div>
    </div>
  );
}
