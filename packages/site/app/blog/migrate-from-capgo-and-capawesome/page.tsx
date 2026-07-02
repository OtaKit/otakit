import type { Metadata } from 'next';

import { BlogArticle, Callout, Code, Pre } from '../_components/BlogArticle';
import { getBlogPost } from '@/lib/blog';

const post = getBlogPost('migrate-from-capgo-and-capawesome');

const capgoApiRows = [
  ['notifyAppReady()', 'notifyAppReady()', 'Exact mapping.'],
  ['getLatest()', 'check()', 'Exact job: ask whether a newer bundle exists for the current lane.'],
  ['download()', 'download()', 'Same manual staging step.'],
  ['next() / set() / reload()', 'apply() or update()', 'Same install job, with a smaller bundle lifecycle in OtaKit.'],
  [
    'setChannel() / unsetChannel() / listChannels()',
    'Fixed channel in config or separate build lanes',
    'Move mutable device routing into explicit release lanes so installs stay predictable.',
  ],
  [
    'setCustomId()',
    'App-level feature flags or a dedicated support lane',
    'Keep user segmentation in your app or backend instead of in the OTA transport itself.',
  ],
  [
    'reset()',
    'Release rollback or builtin fallback',
    'OtaKit keeps rollback at startup-health and release level instead of exposing a client reset API.',
  ],
];

const capawesomeApiRows = [
  ['ready()', 'notifyAppReady()', 'Same readiness handshake, different name.'],
  ['sync()', 'check() + download() + apply() or update()', 'Same job, but OtaKit keeps the control surface smaller.'],
  ['downloadBundle()', 'download()', 'Same manual staging step.'],
  [
    'setNextBundle()',
    'Staged download plus apply() or update()',
    'Let OtaKit move to the newest compatible bundle instead of pinning by bundle ID.',
  ],
  ['setChannel()', 'Fixed channel in config or separate build lanes', 'Translate runtime routing into explicit rollout lanes.'],
  [
    'sync({ channel })',
    'Named channels plus promotion',
    'Prefer stable lanes over per-check overrides.',
  ],
  [
    'setConfig() / resetConfig()',
    'Build-time config plus explicit lanes',
    'Move routing decisions out of mutable client state and into release config.',
  ],
  ['reset()', 'Release rollback or builtin fallback', 'OtaKit relies on health checks and release control rather than a reset button.'],
  [
    'setCustomId()',
    'App-level feature flags or a dedicated support lane',
    'Keep per-user behavior in your app logic, not in the OTA transport.',
  ],
];

const useCaseRows = [
  [
    'Native version compatibility',
    'runtimeVersion',
    'Put all native compatibility boundaries into explicit runtime lanes.',
  ],
  [
    'Beta, QA, and production audiences',
    'channel',
    'Keep audience routing in named channels and promote across them.',
  ],
  [
    'Staged production rollout',
    'rollout channels + promotion',
    'Use lanes like qa -> rollout -> production instead of percentage math inside the updater.',
  ],
  [
    'Per-user or per-customer feature exposure',
    'feature flags in your app/backend',
    'Ship compatible code by OTA, and let your product flags decide who sees which feature.',
  ],
  [
    'Support or debugging on a special build',
    'dedicated support channel or support build',
    'Keep the OTA lane fixed for that build instead of mutating channels on live devices.',
  ],
  [
    'Manual update prompt',
    'updateMode: "manual"',
    'Use check(), download(), apply(), or update() when you want app-controlled install UX.',
  ],
  [
    'Recovery from a bad release',
    'notifyAppReady() + automatic rollback + release rollback',
    'OtaKit focuses on health-confirmed activation instead of extra routing controls.',
  ],
  [
    'Large bundles',
    'smaller OTA bundles + normal zip delivery',
    'Keep heavy static assets out of OTA where possible and ship focused web-layer updates.',
  ],
];

export const metadata: Metadata = {
  title: `${post?.title} — OtaKit Blog`,
  description: post?.description,
};

export default function MigratePage() {
  if (!post) {
    return null;
  }

  return (
    <BlogArticle post={post} lastReviewed="April 19, 2026">
      <p>
        This guide assumes your Capacitor app already runs Capgo or Capawesome in production.
        The goal is to show what changes when you move to OtaKit, which parts map cleanly, 
        which parts need workarounds, and how to cut over without breaking
        your current install base.
      </p>

      <h2>Start with the real constraint</h2>
      <p>
        Migrating to OtaKit is a plugin migration, not a dashboard toggle. Devices that already
        have a Capgo or Capawesome native binary will keep talking to that plugin until the user
        installs a new store build that includes OtaKit.
      </p>

      <Callout>
        <p>
          Plan for a temporary dual-system period. Old binaries continue receiving updates from
          Capgo or Capawesome. New binaries receive updates from OtaKit.
        </p>
      </Callout>

      <h2>Inventory your current routing model first</h2>
      <p>
        Before touching code, write down exactly how your current system decides who gets which
        bundle. For many teams that means more than a single channel name.
      </p>
      <ul>
        <li>Which channels exist today?</li>
        <li>Do you override channels at runtime?</li>
        <li>Do you rely on min/max/semver/native-version targeting?</li>
      </ul>
      <p>
        OtaKit works best when that routing model can be reduced to fixed lanes:
        {' '}
        <Code>channel</Code> for rollout audience and <Code>runtimeVersion</Code> for native
        compatibility.
      </p>
      <p>
        That translation is usually cleaner than it sounds. Most migration decisions collapse into
        four rules: audience becomes <Code>channel</Code>, native compatibility becomes{' '}
        <Code>runtimeVersion</Code>, release pacing becomes channel promotion, and user-specific
        behavior moves to app-level feature flags instead of living inside the OTA transport.
      </p>

      <h2>Capgo to OtaKit</h2>
      <p>
        Capgo exposes more routing knobs than OtaKit. The migration works by collapsing that extra
        routing logic into OtaKit&apos;s smaller lane model, not by recreating every knob one by one.
      </p>

      <h3>Config translation</h3>
      <p>Typical Capgo production config:</p>
      <Pre>{`plugins: {
  CapacitorUpdater: {
    appId: "com.example.app",
    autoUpdate: true,
    defaultChannel: "production",
    directUpdate: "onLaunch",
    periodCheckDelay: 600,
    appReadyTimeout: 10000,
    publicKey: "YOUR_PUBLIC_KEY"
  }
}`}</Pre>
      <p>Closest OtaKit equivalent:</p>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "app_xxxxxxxx",
    channel: "production",
    updateMode: "next-resume",
    checkInterval: 600000,
    appReadyTimeout: 10000
  }
}`}</Pre>
      <ul>
        <li>
          <Code>defaultChannel</Code> maps directly to <Code>channel</Code>.
        </li>
        <li>
          <Code>periodCheckDelay</Code> is seconds in Capgo, while OtaKit <Code>checkInterval</Code>{' '}
          is milliseconds.
        </li>
        <li>
          <Code>directUpdate</Code> mostly translates by activation style:
        </li>
        <li>
          <Code>false</Code> maps to <Code>next-launch</Code> for the quietest production behavior.
        </li>
        <li>
          <Code>&quot;always&quot;</Code> maps to <Code>immediate</Code>.
        </li>
        <li>
          <Code>&quot;onLaunch&quot;</Code> usually maps best to <Code>next-resume</Code> if you want
          fast adoption without surprising the user mid-session.
        </li>
        <li>
          <Code>&quot;atInstall&quot;</Code> is usually handled by shipping the right native baseline
          plus normal OtaKit checks on top of it.
        </li>
      </ul>

      <h3>Runtime API translation</h3>
      <DataTable
        headers={['Capgo', 'OtaKit', 'Migration note']}
        rows={capgoApiRows}
      />

      <p>
        The main design change is channel control. Capgo supports forced device mapping, per-device
        overrides, config defaults, and cloud defaults. In OtaKit, the same migration usually means
        choosing a fixed channel per build and keeping user-specific behavior outside the updater.
      </p>

      <h3>Version targeting translation</h3>
      <p>
        The optimistic translation is straightforward: all version-related routing becomes
        <Code>runtimeVersion</Code>. If your Capgo setup uses semver rules, native-version flags, or
        multiple version-specific channels, flatten them into explicit OtaKit runtime lanes.
      </p>
      <p>Capgo example:</p>
      <Pre>{`npx @capgo/cli bundle upload --channel production --native-version "2.0.0"`}</Pre>
      <p>OtaKit equivalent model:</p>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "app_xxxxxxxx",
    channel: "production",
    runtimeVersion: "2.0.0"
  }
}`}</Pre>
      <Pre>{`otakit upload --release production`}</Pre>
      <p>
        In practice, that usually makes the release model easier to reason about: one audience lane
        and one compatibility lane. If your current Capgo setup uses semver boundaries or version
        filters, the migration step is to name those baselines explicitly and release into those
        runtime lanes.
      </p>

      <h2>Capawesome to OtaKit</h2>
      <p>
        Capawesome exposes a broader runtime API around bundles, channels, config overrides, version
        restrictions, rollouts, and delta delivery. OtaKit takes a narrower approach on purpose:
        fewer moving parts in the runtime, fewer routing states on the device, and a smaller OTA
        mental model.
      </p>

      <h3>Config translation</h3>
      <p>Typical Capawesome production config:</p>
      <Pre>{`plugins: {
  LiveUpdate: {
    appId: "6e351b4f-69a7-415e-a057-4567df7ffe94",
    defaultChannel: "production",
    autoUpdateStrategy: "background",
    readyTimeout: 10000,
    publicKey: "YOUR_PUBLIC_KEY",
    serverDomain: "api.cloud.capawesome.io",
    autoDeleteBundles: true,
    autoBlockRolledBackBundles: true
  }
}`}</Pre>
      <p>Closest OtaKit equivalent:</p>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "app_xxxxxxxx",
    channel: "production",
    updateMode: "next-launch",
    appReadyTimeout: 10000
  }
}`}</Pre>
      <ul>
        <li>
          <Code>defaultChannel</Code> maps directly to <Code>channel</Code>.
        </li>
        <li>
          <Code>readyTimeout</Code> maps directly to <Code>appReadyTimeout</Code>.
        </li>
        <li>
          <Code>autoUpdateStrategy: "background"</Code> maps to OtaKit automatic modes. Choose
          <Code>next-launch</Code> for the quietest installs or <Code>next-resume</Code> for faster
          adoption.
        </li>
        <li>
          Hosted OtaKit does not ask you to port Capawesome&apos;s hosted <Code>serverDomain</Code>{' '}
          or hosted <Code>publicKey</Code> setup.
        </li>
        <li>
          <Code>autoDeleteBundles</Code> and <Code>autoBlockRolledBackBundles</Code> become part of
          OtaKit&apos;s simpler retention and rollback model rather than extra per-app knobs.
        </li>
      </ul>

      <h3>Runtime API translation</h3>
      <DataTable
        headers={['Capawesome', 'OtaKit', 'Migration note']}
        rows={capawesomeApiRows}
      />

      <h3>Versioned channels and versioned bundles</h3>
      <p>
        Capawesome supports both versioned channels and versioned bundles with min, max, and
        equivalent version codes per platform. In OtaKit, the clean translation is to move that
        compatibility logic into explicit <Code>runtimeVersion</Code> lanes.
      </p>
      <p>Capawesome example:</p>
      <Pre>{`npx @capawesome/cli apps:liveupdates:upload \\
  --channel production \\
  --android-min 10 --android-max 12 --android-eq 11 \\
  --ios-min 10 --ios-max 12 --ios-eq 11`}</Pre>
      <p>OtaKit equivalent model:</p>
      <Pre>{`plugins: {
  OtaKit: {
    appId: "app_xxxxxxxx",
    channel: "production",
    runtimeVersion: "11"
  }
}`}</Pre>
      <Pre>{`otakit upload --release production`}</Pre>
      <p>
        If you currently depend on version ranges, the migration step is to turn those ranges into
        named native baselines and release separately for each one. The result is usually easier to
        operate because the compatibility contract is explicit.
      </p>

      <h2>How advanced use cases translate into OtaKit</h2>
      <p>
        OtaKit intentionally keeps the OTA surface narrow. That does not mean the important
        production use cases disappear. It means they usually move into simpler primitives.
      </p>
      <DataTable
        headers={['Use case', 'OtaKit approach', 'How to handle it']}
        rows={useCaseRows}
      />

      <h2>Recommended production cutover</h2>
      <ol>
        <li>Freeze competitor-side routing changes unless they are needed for active incidents.</li>
        <li>
          Export or document every existing channel, override rule, rollout rule, and native-version
          rule.
        </li>
        <li>
          Decide the OtaKit lane model up front: base channel only, named channels, and whether you
          need <Code>runtimeVersion</Code> from day one.
        </li>
        <li>
          Remove <Code>@capgo/capacitor-updater</Code> or{' '}
          <Code>@capawesome/capacitor-live-update</Code>, install{' '}
          <Code>@otakit/capacitor-updater</Code>, update <Code>capacitor.config.*</Code>, and sync
          native projects.
        </li>
        <li>
          Wire <Code>notifyAppReady()</Code> into the real app-ready path before shipping anything.
        </li>
        <li>Publish a new store build that contains OtaKit.</li>
        <li>
          Keep Capgo or Capawesome alive for old binaries while the new build rolls through the store
          install base.
        </li>
        <li>
          Release the first OtaKit bundle to a non-production lane and verify download, activation,
          rollback, and runtimeVersion isolation.
        </li>
        <li>Promote the tested bundle to the intended production lane.</li>
        <li>Retire the old OTA lanes only after the old binaries have largely aged out.</li>
      </ol>

      <h2>Release flow in OtaKit</h2>
      <p>Once the new binary exists, the hosted release flow is intentionally small:</p>
      <Pre>{`npm run build
otakit upload --release

# release to a named channel
otakit upload --release staging

# promote an existing uploaded bundle later
otakit release <bundle-id> --channel production`}</Pre>
      <p>
        The important simplification is that OtaKit resolves devices by fixed lane. The same
        simplification is also the main reason migrations often end up easier to operate once the
        lane model is set.
      </p>

      <h2>Practical migration rule</h2>
      <ul>
        <li>
          If you use channels today, keep using channels.
        </li>
        <li>
          If your current setup depends on delta delivery for very large bundles, tighten the OTA
          bundle boundary first and keep heavy static assets outside OTA.
        </li>
        <li>
          If you use native-version rules today, move them into <Code>runtimeVersion</Code>.
        </li>
        <li>
          If you use staged rollouts today, represent them with explicit rollout lanes and promotion.
        </li>
        <li>
          If you use user-specific behavior today, move that concern into feature flags or backend
          targeting and let OtaKit focus on shipping the right compatible bundle.
        </li>
      </ul>
    </BlogArticle>
  );
}

function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="mt-4 overflow-x-auto border border-border">
      <table className="min-w-full border-collapse text-left text-sm text-muted-foreground">
        <thead className="bg-muted/50 text-foreground">
          <tr>
            {headers.map((header) => (
              <th key={header} className="border-b border-border px-4 py-3 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child_td]:border-b-0">
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className="align-top">
              {row.map((cell, cellIndex) => (
                <td key={`${row[0]}-${cellIndex}`} className="border-b border-border px-4 py-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
