import { BlogArticle, Callout, Code, DataTable, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('best-live-update-frameworks-for-capacitor-apps')!;

export const metadata = blogPostMetadata(post.slug);

const comparisonRows = [
  ['Pricing based on', 'Updates delivered', 'Monthly active users + bandwidth + storage', 'Monthly active users'],
  ['Free tier', '10,000 updates/mo, unlimited apps', 'Trial-oriented free tier', '14-day trial'],
  ['First paid tier', '$25/mo (1M updates)', '$12/mo (2,000 MAU)', '$9/mo (1,000 MAU)'],
  ['Delta updates', 'Yes (per-file, content-addressed)', 'Yes', 'Yes'],
  ['End-to-end encryption', 'Yes (AES-256-GCM, opt-in)', 'Yes', 'Public-key verification'],
  ['Automatic rollback', 'Yes (health handshake)', 'Yes', 'Yes (rollback protection)'],
  ['Staged rollout', 'Channels + promotion', 'Percentage rollout + channels', 'Percentage rollout'],
  ['Runtime channel switching', 'Yes (setChannel())', 'Yes', 'Yes'],
  ['Device delivery path', '100% CDN edge (Cloudflare)', 'Vendor servers + CDN', 'Vendor cloud'],
  ['End-user tracking', 'None (no device IDs)', 'Per-device (MAU metering)', 'Per-device (MAU metering)'],
  ['Open source', 'Entire stack, MIT', 'Plugin + server (license terms vary)', 'Plugin only'],
  ['Native builds / CI product', 'No — OTA only', 'Yes', 'Yes'],
];

export default function BestFrameworksPage() {
  return (
    <BlogArticle post={post}>
      <p>
        If you&apos;re shipping a Capacitor app in 2026, the live-update short list is three tools:{' '}
        <strong>OtaKit</strong>, <strong>Capgo</strong>, and <strong>Capawesome</strong>. All three
        deliver web-layer updates over the air, all three handle rollback, and all three are
        actively maintained. The real differences are in pricing model, delivery architecture, and
        how much product surface you want around the core job.
      </p>
      <p>
        We build OtaKit, so read the recommendations with that in mind — but the facts below come
        from each vendor&apos;s public pricing and documentation as of July 2026, and we&apos;ve
        tried to state plainly where the others are strong.
      </p>

      <h2>The quick answer</h2>
      <ul>
        <li>
          <strong>Choose OtaKit</strong> if you want focused, safe OTA with the simplest pricing in
          the category — billed on updates delivered, not users — and a fully open-source stack you
          could self-host tomorrow.
        </li>
        <li>
          <strong>Choose Capgo</strong> if you want live updates bundled with native builds and a
          broad feature buffet, and you&apos;re comfortable with MAU + bandwidth + storage
          metering.
        </li>
        <li>
          <strong>Choose Capawesome</strong> if you&apos;re already invested in the Capawesome
          plugin ecosystem and want live updates from the same vendor, with cloud builds as an
          upsell.
        </li>
      </ul>

      <h2>Side by side</h2>
      <DataTable headers={['', 'OtaKit', 'Capgo', 'Capawesome']} rows={comparisonRows} />
      <p>
        Pricing snapshot, July 2026: Capgo&apos;s tiers run Solo $12/mo (2,000 MAU, 100&nbsp;GiB
        bandwidth) → Maker $33 → Team $83 → Enterprise $208+, with per-MAU, per-GiB overages.
        Capawesome&apos;s live-update plans run $9/mo (1,000 MAU) → $29 (10K) → $79 (50K) → $249
        (250K). OtaKit is free to 10,000 updates/month, then $25/mo for a million. Always check the
        vendors&apos; pricing pages — these numbers move.
      </p>

      <h2>The pricing model matters more than the price</h2>
      <p>
        MAU-based pricing has a structural quirk: you pay for every active user every month whether
        you ship zero updates or fifty. It also requires the vendor to identify and count your
        devices — that&apos;s what a &ldquo;monthly active user&rdquo; is. Bandwidth metering adds
        a second variable that&apos;s hard to predict if your bundles are large.
      </p>
      <p>
        OtaKit bills on one number: updates actually delivered. Ship nothing in a quiet month, pay
        nothing extra. A big app that releases twice a month can cost less than a small app that
        releases daily — which maps to the value you&apos;re getting, not to how popular your app
        is. And because devices aren&apos;t individually metered, OtaKit doesn&apos;t fingerprint
        or track your end users at all.
      </p>

      <h2>OtaKit</h2>
      <p>
        OtaKit is built around a small set of primitives — <Code>appId</Code>, channel, runtime
        version, bundle, release — and a strict safety pipeline: ES256-signed manifests, SHA-256
        verification of every download, staged activation, and automatic rollback if the app
        doesn&apos;t confirm a healthy boot via <Code>notifyAppReady()</Code>. Delta updates ship
        only changed files; optional end-to-end encryption (AES-256-GCM) keeps bundle contents
        unreadable even to OtaKit itself.
      </p>
      <p>
        The architectural bet is CDN-direct delivery: devices pull manifests and bundles straight
        from Cloudflare&apos;s edge, never from OtaKit&apos;s servers. Delivery uptime and latency
        are the CDN&apos;s, not ours — and skipping origin infrastructure is what makes the pricing
        possible. The entire stack (plugin, CLI, dashboard, ingest) is MIT-licensed in{' '}
        <A href="https://github.com/OtaKit/otakit">one repo</A>, and the self-hosted deployment is
        the same code as the hosted one.
      </p>
      <p>
        What OtaKit deliberately doesn&apos;t do: native builds, app store publishing, or CI
        hosting. It&apos;s an OTA tool, not an app platform.
      </p>

      <h2>Capgo</h2>
      <p>
        Capgo is the most established option and the broadest one: live updates plus native builds,
        app store publishing, 149+ plugins, an MCP server, and channels with per-device targeting
        and percentage rollouts. It cut prices substantially in April 2026 and offers unlimited
        live updates on every tier, metered by MAU, bandwidth, and storage.
      </p>
      <p>
        It&apos;s a genuinely capable product. The trade-off is surface area: more routing concepts
        (per-device overrides, cloud channel defaults, self-assignment) and a three-variable bill.
        Teams that want maximum knobs will like it; teams that want a release model they can
        explain on one whiteboard may find it heavy.
      </p>

      <h2>Capawesome</h2>
      <p>
        Capawesome&apos;s Live Update plugin is polished and feature-rich — automatic update
        strategies, rollback protection, percentage rollouts, delta updates, runtime configuration,
        and lifecycle events — and it comes from the team behind a well-regarded Capacitor plugin
        collection. If you already license their Insider SDKs, the bundling is attractive.
      </p>
      <p>
        The cloud side is younger than Capgo&apos;s, the plugin is the only open-source piece, and
        pricing is MAU-gated from the first tier ($9/mo covers 1,000 MAU). For a hobby app
        that&apos;s fine; for a consumer app with six-figure installs, do the MAU math before
        committing.
      </p>

      <h2>How to actually decide</h2>
      <p>Skip the feature-matrix staring contest and answer four questions:</p>
      <ol>
        <li>
          <strong>What does your bill look like at 10x your current users?</strong> MAU pricing
          scales with popularity; per-update pricing scales with your release cadence.
        </li>
        <li>
          <strong>What happens when a release breaks at 2 a.m.?</strong> All three roll back —
          compare how much configuration stands between you and &ldquo;safe by default.&rdquo;
        </li>
        <li>
          <strong>Could you leave?</strong> An MIT-licensed full stack means self-hosting is an
          exit, not a rewrite.
        </li>
        <li>
          <strong>Do you want an OTA tool or an app platform?</strong> If you need hosted native
          builds, Capgo and Capawesome offer them; OtaKit intentionally doesn&apos;t.
        </li>
      </ol>

      <Callout>
        <p>
          &ldquo;Best&rdquo; rarely means most features. It usually means fewest moving parts for
          the release process your team actually runs.
        </p>
      </Callout>

      <p>
        If OtaKit sounds like the right shape, the <A href="/docs/setup">setup guide</A> takes
        about ten minutes — and if you&apos;re coming from one of the other two, there&apos;s a{' '}
        <A href="/blog/migrate-from-capgo-and-capawesome">dedicated migration guide</A> with exact
        config translations.
      </p>
    </BlogArticle>
  );
}
