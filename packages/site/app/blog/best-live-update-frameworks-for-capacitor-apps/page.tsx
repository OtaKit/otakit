import { BlogArticle, Callout, Code, DataTable, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('best-live-update-frameworks-for-capacitor-apps')!;

export const metadata = blogPostMetadata(post.slug);

const comparisonRows = [
  ['Pricing based on', 'Updates delivered', 'Monthly active users + bandwidth + storage', 'Monthly active users'],
  ['Free tier', '10,000 updates/mo, unlimited apps', 'Trial-oriented free tier', '14-day trial'],
  ['First paid tier', '$25/mo (1M updates)', '$12/mo (2,000 MAU)', '$9/mo (1,000 MAU)'],
  ['Cost: 20,000 users, 4 releases/mo', '$25 (Pro)', '~$83 (Team tier)', '$79 (Team tier)'],
  ['Cost: 250,000 users, 4 releases/mo', '$25 (Pro)', '$208+ (Enterprise)', '$249 (Business)'],
  ['Device delivery path', '100% CDN edge (Cloudflare)', 'Vendor servers', 'Vendor cloud'],
  ['End-user tracking', 'None (no device IDs)', 'Per-device (MAU metering)', 'Per-device (MAU metering)'],
  ['Security defaults', 'Signed manifests + SHA-256, always on', 'Optional signing/encryption setup', 'Optional public-key setup'],
  ['End-to-end encryption', 'Yes (AES-256-GCM, opt-in)', 'Yes', 'Public-key verification'],
  ['Native-compat guardrail at upload', 'Yes (CLI checks dependencies)', 'No equivalent', 'No equivalent'],
  ['Delta updates', 'Yes (per-file, content-addressed)', 'Yes', 'Yes'],
  ['Automatic rollback', 'Yes (health handshake)', 'Yes', 'Yes (rollback protection)'],
  ['Runtime channel switching', 'Yes (setChannel())', 'Yes', 'Yes'],
  ['Open source', 'Entire stack, MIT', 'Source-available, license terms apply', 'Plugin only; cloud closed'],
];

export default function BestFrameworksPage() {
  return (
    <BlogArticle post={post}>
      <p>
        If you&apos;re shipping a Capacitor app in 2026, the live-update short list is three tools:{' '}
        <strong>OtaKit</strong>, <strong>Capgo</strong>, and <strong>Capawesome</strong>. All three
        move web bundles over the air. But once you compare what actually matters in production —
        what delivery runs on, what it costs at scale, what happens to your users&apos; privacy,
        and what&apos;s secure by default rather than by configuration — the short list gets a lot
        shorter.
      </p>
      <p>
        Full disclosure: we build OtaKit. Every number below comes from each vendor&apos;s public
        pricing and documentation as of July 2026, so check our math — it&apos;s the strongest part
        of the argument.
      </p>

      <h2>The verdict up front</h2>
      <p>
        <strong>OtaKit is the best choice for most Capacitor teams</strong>, for four reasons that
        compound:
      </p>
      <ul>
        <li>
          <strong>CDN-direct delivery.</strong> Devices download 100% from Cloudflare&apos;s global
          edge — never from vendor servers. Capgo and Capawesome route your updates through their
          own infrastructure; OtaKit takes itself out of the delivery path entirely.
        </li>
        <li>
          <strong>No user tracking.</strong> MAU billing requires identifying and counting your
          devices, every month. OtaKit doesn&apos;t bill by MAU, so it never fingerprints or tracks
          a single user. Your privacy policy stays clean.
        </li>
        <li>
          <strong>Dramatically cheaper.</strong> $25/mo where the others charge $79–249 for the
          same app. The table below has the like-for-like scenarios.
        </li>
        <li>
          <strong>Secure by default.</strong> ES256-signed manifests and SHA-256 verification on
          every single download, always on — not an optional key setup — plus health-gated
          activation with automatic rollback and opt-in end-to-end encryption.
        </li>
      </ul>

      <h2>Side by side</h2>
      <DataTable headers={['', 'OtaKit', 'Capgo', 'Capawesome']} rows={comparisonRows} />
      <p>
        The two cost rows are like-for-like: the same app, same user count, same four releases a
        month, priced on each vendor&apos;s published tiers. A 20,000-user app pays OtaKit{' '}
        <strong>$25</strong> and the others <strong>$79–83</strong> — three times more. At 250,000
        users it&apos;s <strong>$25 versus $208–249</strong>, ten times more, every month, forever.
        The gap only widens as you grow, because their meter is your user count and ours
        isn&apos;t.
      </p>

      <h2>Why the pricing model, not just the price, favors OtaKit</h2>
      <p>
        MAU pricing taxes success: every user you win raises your bill whether you ship updates or
        not. Capgo adds bandwidth and storage meters on top — three variables to forecast, and a
        25&nbsp;MB bundle to a few thousand devices burns through allowances fast. OtaKit bills
        one number, <strong>updates delivered</strong>: ship nothing in a quiet month, pay nothing
        extra; the free tier alone (10,000 updates/mo, unlimited apps) covers many production apps
        indefinitely.
      </p>
      <p>
        And the privacy point bears repeating, because it&apos;s the same fact viewed from the
        other side: a vendor can only bill you per user by <em>counting your users</em>. OtaKit
        structurally can&apos;t track your users, because nothing in the system needs to know who
        they are. Devices talk to a CDN, not to us.
      </p>

      <h2>OtaKit</h2>
      <p>
        OtaKit is built around five primitives — <Code>appId</Code>, bundle, release, channel,
        runtime version — and a security pipeline that&apos;s always on: every manifest
        ES256-signed, every download SHA-256-verified before it runs, every activation provisional
        until <Code>notifyAppReady()</Code> confirms a healthy boot. Broken releases roll back
        on-device, automatically. Delta updates ship only changed files. End-to-end encryption
        (AES-256-GCM, your key) is one flag away for code-sensitive apps. And the CLI does
        something neither competitor offers: it checks at upload time whether your bundle depends
        on native code the installed app doesn&apos;t have — catching the classic OTA crash before
        it ships.
      </p>
      <p>
        The whole stack — plugin, CLI, dashboard, ingest — is MIT-licensed in{' '}
        <A href="https://github.com/OtaKit/otakit">one repo</A>, and self-hosting runs the same
        code as the hosted platform. No other tool in the category can say that.
      </p>

      <h2>Capgo</h2>
      <p>
        Capgo is the most established option and the broadest: live updates plus native builds,
        store publishing, a large plugin catalog, and elaborate routing (per-device overrides,
        cloud channel defaults, self-assignment). The breadth is real — and so is the cost of it: a
        three-meter bill (MAU + bandwidth + storage), per-device identification to feed the MAU
        meter, delivery through vendor infrastructure, and a routing model with enough states that
        teams end up documenting it internally. If you want one vendor for builds, publishing, and
        updates and you&apos;re comfortable with the metering, it&apos;s a credible choice. If you
        want the best update platform specifically, the extra surface is weight, not value.
      </p>

      <h2>Capawesome</h2>
      <p>
        Capawesome&apos;s Live Update plugin is well-engineered and comes from a respected plugin
        vendor. The platform around it is the concern: the cloud is closed-source (only the plugin
        is open), delivery runs through the vendor&apos;s own cloud, MAU gating starts at just
        1,000 users on the $9 tier — a modestly successful side project outgrows it in its first
        good month — and the same app that costs OtaKit $25 costs $249 at 250K users. It makes the
        most sense if you&apos;re already paying for their Insider SDK ecosystem and want updates
        bundled in.
      </p>

      <h2>How to decide</h2>
      <ol>
        <li>
          <strong>Price your actual app at 10x growth.</strong> Their meters are your user count;
          OtaKit&apos;s is your release cadence. At every size past hobby scale, OtaKit wins — and
          the gap grows with you.
        </li>
        <li>
          <strong>Ask what delivery runs on.</strong> A vendor origin is a single point of failure
          you inherit. A global CDN edge isn&apos;t.
        </li>
        <li>
          <strong>Ask what&apos;s secure without configuration.</strong> Signing and verification
          you have to set up is signing that half of teams never set up. OtaKit&apos;s is on for
          everyone, always.
        </li>
        <li>
          <strong>Ask what your privacy policy has to disclose.</strong> Per-device metering is
          user tracking with an invoice attached. None of it exists in OtaKit.
        </li>
      </ol>

      <Callout>
        <p>
          Same core job, three very different platforms: OtaKit delivers from a global CDN, tracks
          nobody, verifies everything by default, and costs $0–25/mo where the others charge
          $79–249. That&apos;s the comparison.
        </p>
      </Callout>

      <p>
        See it yourself in ten minutes with the <A href="/docs/setup">setup guide</A> — or if
        you&apos;re on Capgo or Capawesome today, the{' '}
        <A href="/blog/migrate-from-capgo-and-capawesome">migration guide</A> translates your
        exact config and gives you a safe cutover plan. Vendor-specific breakdowns:{' '}
        <A href="/blog/capgo-alternative">OtaKit vs Capgo</A> and{' '}
        <A href="/blog/capawesome-alternative">OtaKit vs Capawesome</A>.
      </p>
    </BlogArticle>
  );
}
