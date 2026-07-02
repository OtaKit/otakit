import { BlogArticle, Callout, Code, DataTable, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('the-1-alternative-to-capgo-capawesome')!;

export const metadata = blogPostMetadata(post.slug);

const priceRows = [
  ['5,000 users, 2 releases/mo', '$0 (free tier)', '$33 (Maker, 10K MAU)', '$29 (10K MAU)'],
  ['50,000 users, 4 releases/mo', '$25 (Pro)', '$83 (Team, 100K MAU)', '$79 (50K MAU)'],
  ['250,000 users, 4 releases/mo', '$25 (Pro)', '$208+ (Enterprise)', '$249 (250K MAU)'],
];

export default function AlternativePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Let&apos;s not bury the conclusion: for live updates in Capacitor apps, OtaKit is the
        better product at a fraction of the price. That&apos;s a strong claim from the people who
        build it, so this post does what strong claims require — it shows the numbers, names the
        architecture, and links the receipts.
      </p>

      <h2>Cheaper — and not by a little</h2>
      <p>
        Capgo and Capawesome both meter <strong>monthly active users</strong>: every active device
        counts against your plan every month, whether you shipped fifty updates or none. Capgo adds
        bandwidth and storage meters on top. As your app grows, your bill grows — automatically,
        forever.
      </p>
      <p>
        OtaKit meters one thing: <strong>updates actually delivered</strong>. Free covers 10,000
        updates a month with unlimited apps; Pro is $25/mo (billed yearly) for a million. Here is
        what that means at real-world sizes, using each vendor&apos;s public pricing as of July
        2026:
      </p>
      <DataTable
        headers={['Your app', 'OtaKit', 'Capgo', 'Capawesome (Live Updates)']}
        rows={priceRows}
      />
      <p>
        The pattern is structural, not promotional. MAU pricing taxes your success: more users,
        bigger bill, even in months you ship nothing. Per-update pricing tracks the value you
        actually consume — and at every size above hobby scale, it comes out dramatically cheaper.
        For the vendor-specific math, see the dedicated breakdowns:{' '}
        <A href="/blog/capgo-alternative">OtaKit as a Capgo alternative</A> and{' '}
        <A href="/blog/capawesome-alternative">OtaKit as a Capawesome alternative</A>.
      </p>

      <h2>Better — because of one architectural decision</h2>
      <p>
        OtaKit delivers every manifest and every bundle from Cloudflare&apos;s global CDN edge —
        100% of device traffic, no vendor origin servers in the path. That single decision produces
        the three advantages that matter most in production:
      </p>
      <ul>
        <li>
          <strong>Reliability.</strong> Update delivery runs on one of the most resilient networks
          on earth, not on a startup&apos;s API servers. Our uptime can&apos;t cap your delivery.
        </li>
        <li>
          <strong>Speed everywhere.</strong> Devices download from the nearest edge node on every
          continent, not from a single origin region.
        </li>
        <li>
          <strong>Privacy by construction.</strong> Because we don&apos;t bill by MAU, we never
          need to identify devices. No fingerprinting, no per-user tracking — anonymous release
          analytics only. MAU-billed vendors must count your users; that&apos;s what the meter is.
        </li>
      </ul>

      <h2>Full feature parity where it counts</h2>
      <p>Cheaper doesn&apos;t mean fewer capabilities. Everything production teams rely on is here:</p>
      <ul>
        <li>
          <strong>Delta updates</strong> — per-file, content-addressed delivery; devices download
          only what changed. Asset-heavy apps update in kilobytes.
        </li>
        <li>
          <strong>End-to-end encryption</strong> — opt-in AES-256-GCM with a key only you hold;
          the CDN and storage see ciphertext only.
        </li>
        <li>
          <strong>Automatic rollback</strong> — every activation is provisional until{' '}
          <Code>notifyAppReady()</Code> confirms a healthy boot; failures roll back on-device.
        </li>
        <li>
          <strong>Channels with runtime switching</strong> — production, beta, or custom tracks,
          plus <Code>setChannel()</Code> for in-app &ldquo;join the beta&rdquo; toggles.
        </li>
        <li>
          <strong>Emergency releases</strong> — <Code>--force-immediate</Code> puts a critical fix
          on devices at their very next check.
        </li>
        <li>
          <strong>A native-compatibility guardrail</strong> — the CLI catches bundles that depend
          on native code the installed app doesn&apos;t have, at upload time, before they ship.
        </li>
        <li>
          <strong>Update lifecycle events</strong> — build any update UX you want on{' '}
          <Code>updateAvailable</Code>, <Code>updateStaged</Code>, <Code>updateApplied</Code>, and{' '}
          <Code>rollback</Code>.
        </li>
      </ul>

      <h2>Open source without an asterisk</h2>
      <p>
        The entire OtaKit stack — plugin, CLI, dashboard, ingest — is MIT-licensed in{' '}
        <A href="https://github.com/OtaKit/otakit">a single repository</A>, and the self-hosted
        deployment runs the same code as the hosted platform. Capawesome open-sources only the
        plugin; Capgo&apos;s licensing deserves a careful read before you depend on it. With
        OtaKit, you can audit every line that touches your users, and leaving the hosted service
        is an infrastructure decision, not a rewrite. A vendor you can walk away from is a vendor
        that has to keep earning you.
      </p>

      <h2>Deliberately focused</h2>
      <p>
        Capgo and Capawesome bundle live updates with native build farms, store publishing, and
        plugin catalogs. OtaKit does one job — safe, fast OTA for the web layer — and does it with
        fewer concepts, a smaller API, and a release model your whole team can hold in their
        heads. Your CI already builds your app. What it needs from an OTA vendor is delivery
        that&apos;s cheap, safe, and boring. That&apos;s the product.
      </p>

      <Callout>
        <p>
          Same live updates. Stronger delivery architecture. No user tracking. Fully open source.
          At 250,000 users: $25/mo instead of $208–249.
        </p>
      </Callout>

      <h2>Switching takes an afternoon</h2>
      <Pre>{`npm install @otakit/capacitor-updater
# add appId to capacitor.config.ts, call notifyAppReady() on boot

npm run build
otakit upload --release`}</Pre>
      <p>
        Start with the <A href="/docs/setup">setup guide</A>, or go straight to the{' '}
        <A href="/blog/migrate-from-capgo-and-capawesome">migration guide</A> — it translates your
        exact Capgo or Capawesome config, API calls, and routing model into OtaKit, with a cutover
        plan that keeps your existing install base safe.
      </p>
    </BlogArticle>
  );
}
