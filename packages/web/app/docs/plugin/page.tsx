import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Plugin API — OtaKit Docs',
  description:
    'Capacitor plugin setup, default automatic updates, manual advanced flows, and debug methods.',
};

export default function PluginReferencePage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Plugin API</h1>
      <P>
        Import from <Code>@otakit/capacitor-updater</Code>. For normal app code, the normal hosted
        flow usually only needs <Code>notifyAppReady()</Code>. The other public methods exist for
        advanced manual update flows where your app decides when to check, download, and apply an
        update.
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
    // updateMode: "next-resume",
  }
}`}</Pre>
      <div className="mt-4 overflow-x-auto rounded-lg border text-xs">
        <ConfigRow
          field="appId"
          type="string"
          description="OtaKit app ID for manifest and stats access."
        />
        <ConfigRow
          field="channel"
          type="string"
          description="Named release track to check. Omit it to use the base channel."
        />
        <ConfigRow
          field="updateMode"
          type="'manual' | 'next-launch' | 'next-resume' | 'immediate'"
          description="Overall update behavior. Optional, defaults to next-launch."
        />
        <ConfigRow
          field="checkInterval"
          type="number"
          description="Milliseconds between automatic update checks. Optional, defaults to 600000 (10 min)."
        />
        <ConfigRow
          field="appReadyTimeout"
          type="number"
          description="Milliseconds to wait for notifyAppReady(). Optional, defaults to 10000."
          last
        />
      </div>

      <P>
        Hosted OtaKit points at the managed server automatically. Do not set <Code>serverUrl</Code>{' '}
        or <Code>manifestKeys</Code> unless you intentionally want custom server or verification
        behavior.
      </P>

      <Separator className="my-10" />

      <H2>Update Modes</H2>
      <P>All automatic modes check for updates on cold start (always) and app resume (throttled by checkInterval, default 10 minutes).</P>
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
          type="dev/debug"
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
        hosted server.
      </P>
      <P>
        You only need <Code>manifestKeys</Code> when you intentionally override trust for a custom
        or self-hosted server. In that case, also set <Code>serverUrl</Code> to your own API base
        URL.
      </P>

      <Separator className="my-10" />

      <H2>Automatic Flow (Default)</H2>
      <P>
        This is the normal OtaKit flow. Leave <Code>updateMode</Code> unset or set it to{' '}
        <Code>next-launch</Code>. The plugin checks automatically on startup, downloads in the
        background, and activates the new bundle on the next cold app launch.
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
          description="Inspect the current app-facing updater state: current bundle, staged bundle, and builtin version."
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

      <H2>Debug API</H2>
      <P>
        Manual inspection and control methods live under <Code>OtaKit.debug</Code>. These are for
        diagnostics, support, and test flows, not normal app code.
      </P>
      <div className="mt-4 space-y-4">
        <Method
          name="debug.check(options?)"
          returns="LatestVersion | null"
          description="Check the server for a newer bundle without downloading it. You can optionally pass { channel } for a one-off debug override."
        />
        <Method
          name="debug.download(options?)"
          returns="BundleInfo | null"
          description="Debug version of download() that ensures the latest bundle is staged for a one-off { channel } override."
        />
        <Method
          name="debug.reset()"
          returns="void"
          description="Clear active updater state, return to the builtin bundle, clear fallback and last failure state, and reload the WebView. Terminal operation."
        />
        <Method
          name="debug.listBundles()"
          returns="{ bundles: BundleInfo[] }"
          description="List downloaded OTA bundles stored on the device."
        />
        <Method
          name="debug.deleteBundle({ bundleId })"
          returns="void"
          description="Delete a downloaded bundle that is not current, fallback, or staged."
        />
        <Method
          name="debug.getLastFailure()"
          returns="BundleInfo | null"
          description="Return the last failed update metadata for diagnostics. The failed bundle files themselves are cleaned up automatically after rollback."
        />
      </div>

      <Separator className="my-10" />

      <H2>Advanced Overrides</H2>
      <P>Use these only when you run a custom server or need custom verification behavior.</P>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    // Optional advanced overrides
    // serverUrl: "https://your-server.com/api/v1",
    // allowInsecureUrls: false,
    // manifestKeys: [
    //   { kid: "key-2026-01", key: "MFkwEwYH..." }
    // ]
  }
}`}</Pre>
      <div className="mt-4 overflow-x-auto rounded-lg border text-xs">
        <ConfigRow
          field="serverUrl"
          type="string"
          description="Custom OtaKit server URL. Leave unset for the hosted service default."
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
  status: "builtin" | "pending"
    | "trial" | "success" | "error";
  downloadedAt?: string;
  sha256?: string;
  channel?: string;
  releaseId?: string;
}

interface OtaKitState {
  current: BundleInfo;
  staged: BundleInfo | null;
  builtinVersion: string;
}

interface LatestVersion {
  version: string;
  url: string;
  sha256: string;
  size: number;
  downloaded?: boolean;
  releaseId?: string;
  minNativeBuild?: number;
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
