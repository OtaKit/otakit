import { BlogArticle, Callout, Code, DataTable, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('migrate-from-capgo-and-capawesome')!;

export const metadata = blogPostMetadata(post.slug);

const capgoApiRows = [
  ['notifyAppReady()', 'notifyAppReady()', 'Identical name, identical job. Wire it into your real app-ready path.'],
  ['getLatest()', 'check()', 'Ask whether a newer bundle exists for the current lane, without downloading.'],
  ['download()', 'download()', 'Same manual staging step; OtaKit verifies the hash before staging.'],
  ['next() / set() + reload()', 'apply() or update()', 'apply() activates the staged bundle; update() is the one-call "get me current" helper.'],
  ['setChannel() / getChannel()', 'setChannel() / getChannel()', 'Direct mapping. OtaKit persists the override across launches; pass null to clear it.'],
  ['unsetChannel()', 'setChannel({ channel: null })', 'Clearing the override returns the device to the configured channel.'],
  ['listChannels()', 'Dashboard / CLI', 'Channel discovery is an operator concern in OtaKit, not a device API.'],
  ['setCustomId()', 'App-level feature flags', 'Keep per-user targeting in your product logic; OTA decides versions, not cohorts.'],
  ['reset()', 'Automatic rollback + release rollback', 'Recovery is health-driven on device and one click per channel in the dashboard.'],
];

const capawesomeApiRows = [
  ['ready()', 'notifyAppReady()', 'Same readiness handshake, different name.'],
  ['sync()', 'update() — or check() + download() + apply()', 'update() covers the common case in one call; the split API gives full control.'],
  ['fetchLatestBundle()', 'check()', 'Same job: query the lane for a newer version.'],
  ['downloadBundle()', 'download()', 'Same manual staging step.'],
  ['setNextBundle()', 'download() + apply()', 'OtaKit always moves to the newest compatible bundle instead of pinning by ID.'],
  ['setChannel() / getChannel()', 'setChannel() / getChannel()', 'Direct mapping, persisted across launches.'],
  ['addListener(...)', 'addListener(...)', 'Map to updateAvailable, updateStaged, updateApplied, downloadFailed, rollback.'],
  ['reset()', 'Automatic rollback + release rollback', 'Health-confirmed activation replaces the manual reset button.'],
];

const featureRows = [
  ['Channels / audiences', 'channel + setChannel()', 'Named channels with promotion; runtime overrides for opt-in flows like beta toggles.'],
  ['Native version targeting', 'runtimeVersion', 'One explicit compatibility lane per native baseline instead of min/max/semver rules.'],
  ['Delta updates', '--strategy deltas', 'Per-file, content-addressed objects; devices download only changed files.'],
  ['End-to-end encryption', '--encrypt + bundleKeys', 'AES-256-GCM with your key; generate it with otakit generate-encryption-key.'],
  ['Forced/critical updates', '--force-immediate', 'Devices apply and reload on their next check — for emergency fixes.'],
  ['Staged rollout percentages', 'Channels + promotion', 'Promote qa → beta → production explicitly instead of percentage math in the updater.'],
  ['Update lifecycle events', 'addListener()', 'updateAvailable, updateStaged, updateApplied, downloadFailed, rollback.'],
  ['Per-device targeting', 'Feature flags in your app', 'Deliberately not an OTA concern in OtaKit — ship compatible code, gate features in product logic.'],
];

export default function MigratePage() {
  return (
    <BlogArticle post={post}>
      <p>
        This guide assumes your Capacitor app already runs Capgo or Capawesome Live Update in
        production, and walks through the move to OtaKit: what maps one-to-one, what maps to a
        different (usually smaller) concept, and how to cut over without breaking the install base
        you already have in the field.
      </p>

      <h2>The one constraint you can&apos;t skip</h2>
      <p>
        An OTA migration is a <strong>plugin</strong> migration. Devices running your current store
        build have the Capgo or Capawesome plugin compiled into the binary, and they will keep
        checking that vendor&apos;s endpoints until their user installs a store build that contains
        OtaKit instead. There is no server-side switch that reroutes an existing binary.
      </p>

      <Callout>
        <p>
          Plan for a dual-system window: old binaries keep receiving updates from the old vendor,
          new binaries receive them from OtaKit. It typically lasts as long as your store-update
          adoption curve — weeks, not days.
        </p>
      </Callout>

      <h2>Step 0: inventory your routing model</h2>
      <p>
        Before touching code, write down how your current setup decides which device gets which
        bundle: every channel, every runtime override, every min/max/semver native-version rule,
        every percentage rollout. Migrations go wrong when this list lives in three heads and a
        dashboard.
      </p>
      <p>Nearly everything on that list collapses into four OtaKit translations:</p>
      <ul>
        <li>
          Audience → <Code>channel</Code> (with <Code>setChannel()</Code> for user-facing opt-ins).
        </li>
        <li>
          Native compatibility → <Code>runtimeVersion</Code>.
        </li>
        <li>Release pacing → channel promotion.</li>
        <li>Per-user behavior → feature flags in your app, outside the OTA transport.</li>
      </ul>

      <h2>Migrating from Capgo</h2>

      <h3>Config translation</h3>
      <p>A typical Capgo production config:</p>
      <Pre>{`// capacitor.config.ts
plugins: {
  CapacitorUpdater: {
    appId: "com.example.app",
    autoUpdate: true,
    defaultChannel: "production",
    directUpdate: false,
    periodCheckDelay: 600,     // seconds
    appReadyTimeout: 10000,
    publicKey: "YOUR_PUBLIC_KEY"
  }
}`}</Pre>
      <p>The OtaKit equivalent:</p>
      <Pre>{`// capacitor.config.ts
plugins: {
  OtaKit: {
    appId: "app_xxxxxxxx",
    channel: "production",
    // defaults shown explicitly:
    launchPolicy: "apply-staged",   // activate staged bundles on cold start
    resumePolicy: "shadow",         // download in background on resume
    checkInterval: 600000,          // milliseconds, not seconds
    appReadyTimeout: 10000
  }
}`}</Pre>
      <ul>
        <li>
          <Code>defaultChannel</Code> → <Code>channel</Code>, directly.
        </li>
        <li>
          <Code>periodCheckDelay</Code> is <strong>seconds</strong>; OtaKit&apos;s{' '}
          <Code>checkInterval</Code> is <strong>milliseconds</strong>. This is the classic
          migration typo — 600 becomes 600000.
        </li>
        <li>
          <Code>directUpdate</Code> translates by activation timing: <Code>false</Code> (apply on
          next launch) is OtaKit&apos;s default <Code>launchPolicy: &quot;apply-staged&quot;</Code>;{' '}
          <Code>&quot;always&quot;</Code> maps to <Code>launchPolicy: &quot;immediate&quot;</Code>;{' '}
          <Code>&quot;atInstall&quot;</Code> maps to <Code>runtimePolicy: &quot;immediate&quot;</Code>{' '}
          — which is also OtaKit&apos;s default, so fresh installs catch up fast out of the box.
        </li>
        <li>
          Capgo&apos;s <Code>publicKey</Code> encryption maps to OtaKit&apos;s end-to-end
          encryption: run <Code>otakit generate-encryption-key</Code>, ship the key in{' '}
          <Code>bundleKeys</Code>, upload with <Code>--encrypt</Code>. See{' '}
          <A href="/docs/security">Security</A> for the rotation story.
        </li>
      </ul>

      <h3>Runtime API translation</h3>
      <DataTable headers={['Capgo', 'OtaKit', 'Migration note']} rows={capgoApiRows} />
      <p>
        Method names may drift between plugin major versions — treat the table as the conceptual
        map and your IDE as the source of truth.
      </p>

      <h3>Version targeting</h3>
      <p>
        Where Capgo routes by native version metadata on the bundle, OtaKit inverts it: the{' '}
        <strong>app</strong> declares its lane. Each store build sets a <Code>runtimeVersion</Code>{' '}
        in config, and releases into that lane can only reach shells that declared it.
      </p>
      <Pre>{`# Capgo
npx @capgo/cli bundle upload --channel production --native-version "2.0.0"

# OtaKit: the store build declares runtimeVersion: "2.0.0" in config,
# and you release into that lane
otakit upload --release production`}</Pre>
      <p>
        If your Capgo setup uses semver ranges or version filters, name each native baseline
        explicitly and release per lane. It&apos;s more verbose to say and much easier to operate —
        the compatibility contract is visible in one config line instead of spread across upload
        flags.
      </p>

      <h2>Migrating from Capawesome</h2>

      <h3>Config translation</h3>
      <p>A typical Capawesome Live Update production config:</p>
      <Pre>{`// capacitor.config.ts
plugins: {
  LiveUpdate: {
    appId: "6e351b4f-69a7-415e-a057-4567df7ffe94",
    defaultChannel: "production",
    autoUpdateStrategy: "background",
    readyTimeout: 10000,
    publicKey: "YOUR_PUBLIC_KEY",
    autoDeleteBundles: true,
    autoBlockRolledBackBundles: true
  }
}`}</Pre>
      <p>The OtaKit equivalent:</p>
      <Pre>{`// capacitor.config.ts
plugins: {
  OtaKit: {
    appId: "app_xxxxxxxx",
    channel: "production",
    launchPolicy: "apply-staged",
    resumePolicy: "shadow",
    appReadyTimeout: 10000
  }
}`}</Pre>
      <ul>
        <li>
          <Code>defaultChannel</Code> → <Code>channel</Code>; <Code>readyTimeout</Code> →{' '}
          <Code>appReadyTimeout</Code>.
        </li>
        <li>
          <Code>autoUpdateStrategy: &quot;background&quot;</Code> is OtaKit&apos;s default
          behavior: <Code>shadow</Code> on resume, <Code>apply-staged</Code> on launch. Bundles
          download silently and activate on the next cold start.
        </li>
        <li>
          <Code>autoDeleteBundles</Code> and <Code>autoBlockRolledBackBundles</Code> have no
          OtaKit equivalents because the behaviors are built in: the plugin keeps exactly current +
          fallback + staged, and a rolled-back bundle is never re-activated.
        </li>
        <li>
          Capawesome&apos;s public-key bundle signing maps to OtaKit&apos;s always-on signed
          manifests (ES256) plus SHA-256 verification; if you also need content secrecy, add{' '}
          <Code>--encrypt</Code>.
        </li>
        <li>
          If you used Capawesome&apos;s <strong>delta updates</strong>, upload with{' '}
          <Code>--strategy deltas</Code> — same benefit, per-file content-addressed delivery.
        </li>
      </ul>

      <h3>Runtime API translation</h3>
      <DataTable headers={['Capawesome', 'OtaKit', 'Migration note']} rows={capawesomeApiRows} />

      <h3>Version ranges → runtime lanes</h3>
      <p>
        Capawesome&apos;s per-platform min/max/eq version codes become explicit lanes: each native
        baseline declares one <Code>runtimeVersion</Code>, and you release into the lanes you still
        support. Ranges disappear; what remains is a list you can read aloud.
      </p>
      <Pre>{`# Capawesome
npx @capawesome/cli apps:bundles:create \\
  --channel production --android-max 12 --ios-max 12

# OtaKit: one lane per supported native baseline
otakit upload --release production   # runtimeVersion "12" build
otakit upload --release production   # run again from the "11" branch if you still ship fixes there`}</Pre>

      <h2>Feature-by-feature map</h2>
      <DataTable headers={['You use today', 'OtaKit equivalent', 'Notes']} rows={featureRows} />
      <p>
        The one deliberate gap: OtaKit has no per-device targeting inside the OTA transport. Every
        production use we&apos;ve seen for it — support builds, VIP cohorts, gradual exposure — is
        better served by feature flags in the app, where product logic already lives. OTA decides
        which <em>version</em> a lane runs; your app decides which <em>features</em> a user sees.
      </p>

      <h2>The cutover plan</h2>
      <ol>
        <li>Freeze routing changes on the old system except for active incidents.</li>
        <li>Document every channel, override, rollout rule, and version rule (step 0 above).</li>
        <li>
          Decide your OtaKit lane model up front: which named channels, and whether{' '}
          <Code>runtimeVersion</Code> starts now (recommended) or at your next native break.
        </li>
        <li>
          Swap the plugin: remove <Code>@capgo/capacitor-updater</Code> or{' '}
          <Code>@capawesome/capacitor-live-update</Code>, then{' '}
          <Code>npm install @otakit/capacitor-updater</Code>, update{' '}
          <Code>capacitor.config.ts</Code>, and sync native projects.
        </li>
        <li>
          Wire <Code>notifyAppReady()</Code> into your real app-ready path — after your app shell
          renders, not before. This is the rollback safety net; don&apos;t ship without it.
        </li>
        <li>
          Verify the full cycle on a test channel: release, download, activation, a deliberate
          broken build to watch automatic rollback, and a <Code>runtimeVersion</Code> mismatch to
          confirm lane isolation.
        </li>
        <li>Ship the new store build containing OtaKit.</li>
        <li>
          Keep the old vendor account alive while old binaries age out — they still need it for any
          emergency fix you push during the window.
        </li>
        <li>
          Watch adoption in the OtaKit dashboard; when the old binaries are down to a tail you can
          live with, retire the old channels and the old subscription.
        </li>
      </ol>

      <h2>Day-to-day releases after the switch</h2>
      <Pre>{`npm run build
otakit upload --release              # base channel

otakit upload --release staging      # named channel
otakit release <bundle-id> --channel production   # promote the same bundle

otakit upload --release --force-immediate         # emergency fix
otakit upload --release --strategy deltas         # delta delivery`}</Pre>
      <p>
        Questions mid-migration? The <A href="/docs/setup">setup guide</A> and{' '}
        <A href="/docs/update-strategies">update strategies</A> cover the details, and we&apos;re
        happy to help with gnarly routing models at{' '}
        <A href="mailto:support@otakit.app">support@otakit.app</A> — we&apos;ve probably seen
        yours.
      </p>
    </BlogArticle>
  );
}
