import { BlogArticle, Callout, Code, DataTable, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('best-live-update-frameworks-for-capacitor-apps')!;

export const metadata = blogPostMetadata(post.slug);

const comparisonRows = [
  [
    'Pricing based on',
    'Updates delivered',
    'Monthly active users + bandwidth + storage',
    'Monthly active users',
  ],
  ['Free tier', '5,000 updates/mo, unlimited apps — free forever', '14-day trial', '14-day trial'],
  ['First paid tier', '$10/mo (100K updates)', '$12/mo (2,000 MAU)', '$9/mo (1,000 MAU)'],
  ['Device delivery path', '100% CDN edge (Cloudflare)', 'Vendor servers', 'Vendor cloud'],
  [
    'End-user tracking',
    'None (no device IDs)',
    'Per-device (MAU metering)',
    'Per-device (MAU metering)',
  ],
  [
    'Security defaults',
    'Signed manifests + SHA-256, always on',
    'Optional signing/encryption setup',
    'Optional public-key setup',
  ],
  ['End-to-end encryption', 'Yes (AES-256-GCM, opt-in)', 'Yes', 'Public-key verification'],
  [
    'Native compatibility checks',
    'Yes — local CLI and MCP',
    'Yes — CLI and MCP',
    'Version restrictions',
  ],
  [
    'AI-agent workflow',
    'Local + remote MCP and open Agent Skill',
    'MCP and open Agent Skills',
    'Remote MCP and open Agent Skills',
  ],
  ['Delta updates', 'Yes (per-file, content-addressed)', 'Yes', 'Yes'],
  ['Automatic rollback', 'Yes (health handshake)', 'Yes', 'Yes (rollback protection)'],
  ['Runtime channel switching', 'Yes (setChannel())', 'Yes', 'Yes'],
  [
    'Open source',
    'Entire stack, MIT',
    'Source-available, license terms apply',
    'Plugin only; cloud closed',
  ],
];

export default function BestFrameworksPage() {
  return (
    <BlogArticle post={post}>
      <p>
        If you&apos;re shipping a Capacitor app in 2026, the live-update short list is three tools:{' '}
        <strong>OtaKit</strong>, <strong>Capgo</strong>, and <strong>Capawesome</strong>. All three
        move web bundles over the air. But once you compare what actually matters in production —
        what delivery runs on, what it costs at scale, what happens to your users&apos; privacy, and
        what&apos;s secure by default rather than by configuration — the short list gets a lot
        shorter.
      </p>
      <p>
        Full disclosure: we build OtaKit. Every number below comes from each vendor&apos;s public
        pricing and documentation as of August 2026, so check our math — it&apos;s the strongest
        part of the argument.
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
          <strong>Dramatically cheaper.</strong> $10–25/mo where the others charge $29–249 for
          comparable apps. The table below has the like-for-like scenarios.
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
        AI support is not an OtaKit-only checkbox. Capgo publishes both{' '}
        <A href="https://capgo.app/docs/cli/reference/mcp/">MCP tooling</A> and{' '}
        <A href="https://capgo.app/skills/">Agent Skills</A>. Capawesome publishes a{' '}
        <A href="https://capawesome.io/docs/ai/mcp/">remote MCP server</A> and{' '}
        <A href="https://capawesome.io/skills/">open Agent Skills</A>. OtaKit&apos;s distinction is
        how its project-aware local MCP, remote MCP with scoped OAuth, and Agent Skill share one
        exact release model—from project inspection and upload through approval, monitoring, and
        revert.
      </p>
      <p>
        And here&apos;s what the exact same app costs on each vendor&apos;s published pricing,
        assuming weekly releases:
      </p>
      <ul>
        <li>
          At 2,500 users: OtaKit <strong>$10</strong>. Capgo <strong>$33</strong>. Capawesome{' '}
          <strong>$29</strong>.
        </li>
        <li>
          At 20,000 users: OtaKit <strong>$10</strong>. Capgo <strong>~$83</strong>. Capawesome{' '}
          <strong>$79</strong>. Roughly 3x.
        </li>
        <li>
          At 250,000 users: OtaKit <strong>still $25</strong>. Capgo <strong>$208+</strong>.
          Capawesome <strong>$249</strong>. Roughly 10x.
        </li>
      </ul>
      <p>
        The reason is simple: they charge per user, so their price grows with your app. OtaKit
        charges per update delivered, so it doesn&apos;t.
      </p>

      <h2>Why the pricing model, not just the price, favors OtaKit</h2>
      <p>
        MAU pricing taxes success. Every user you win raises your bill — even in months you ship
        nothing. Capgo adds bandwidth and storage meters on top, so you&apos;re forecasting three
        variables instead of one.
      </p>
      <p>
        OtaKit bills one number: <strong>updates delivered</strong>. Quiet month, nothing extra.
        Free includes 5,000 updates a month with unlimited apps, while the $10 Starter plan raises
        that allowance to 100,000 for growing apps.
      </p>
      <p>
        The privacy win is the same fact from the other side. A vendor can only bill per user by{' '}
        <em>counting your users</em>. OtaKit doesn&apos;t bill per user, so it never needs to know
        who they are. Devices talk to a CDN, not to us.
      </p>

      <h2>OtaKit</h2>
      <p>
        OtaKit keeps the model small — app, bundle, release, channel, runtime version — and makes
        the safety non-negotiable:
      </p>
      <ul>
        <li>
          <strong>Everything verified, always.</strong> Every manifest is ES256-signed and every
          download SHA-256-checked before it runs. Not a setting — the default for everyone.
        </li>
        <li>
          <strong>Broken releases fix themselves.</strong> A bundle isn&apos;t trusted until{' '}
          <Code>notifyAppReady()</Code> confirms a healthy boot; otherwise the device rolls back
          automatically.
        </li>
        <li>
          <strong>Delta updates</strong> ship only the files that changed. Kilobytes, not megabytes.
        </li>
        <li>
          <strong>End-to-end encryption</strong> (AES-256-GCM, your key) is one flag away.
        </li>
        <li>
          <strong>Native compatibility checks</strong> compare the project&apos;s Capacitor packages
          with the target release lane before upload or publication.
        </li>
        <li>
          <strong>MCP and Agent Skills</strong> connect coding agents to OtaKit while preserving the
          same release workflow and approval points.
        </li>
      </ul>
      <p>
        And the whole stack — plugin, CLI, dashboard, ingest — is MIT-licensed in{' '}
        <A href="https://github.com/OtaKit/otakit">one repo</A>. Self-hosting runs the same code as
        the hosted platform. No other tool in the category can say that.
      </p>

      <h2>Capgo</h2>
      <p>
        Capgo is the most established option and the broadest: live updates plus native builds,
        store publishing, a large plugin catalog, and elaborate routing controls.
      </p>
      <p>The breadth has a cost, and you pay it three ways:</p>
      <ul>
        <li>A three-meter bill — MAU, bandwidth, and storage — that&apos;s hard to forecast.</li>
        <li>Per-device identification of your users, because the MAU meter requires it.</li>
        <li>Updates delivered through vendor infrastructure, not straight from a CDN edge.</li>
      </ul>
      <p>
        If you want one vendor for builds, publishing, and updates, it&apos;s a credible choice. If
        you want the best update platform specifically, the extra surface is weight, not value.
      </p>

      <h2>Capawesome</h2>
      <p>
        Capawesome&apos;s Live Update plugin is well-engineered and comes from a respected plugin
        vendor. The platform around it is where the questions start:
      </p>
      <ul>
        <li>Only the plugin is open source — the cloud behind it is closed.</li>
        <li>Delivery runs through the vendor&apos;s own cloud.</li>
        <li>The $9 tier covers just 1,000 users. One good month and you&apos;ve outgrown it.</li>
        <li>At 250K users you pay $249/mo — for what costs $25 on OtaKit.</li>
      </ul>
      <p>
        It makes the most sense if you&apos;re already paying for their Insider SDK ecosystem and
        want updates bundled in.
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
          <strong>Ask what your privacy policy has to disclose.</strong> Per-device metering is user
          tracking with an invoice attached. None of it exists in OtaKit.
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
        <A href="/blog/migrate-from-capgo-and-capawesome">migration guide</A> translates your exact
        config and gives you a safe cutover plan. Vendor-specific breakdowns:{' '}
        <A href="/blog/capgo-alternative">OtaKit vs Capgo</A> and{' '}
        <A href="/blog/capawesome-alternative">OtaKit vs Capawesome</A>. To connect an agent, use
        the <A href="/docs/agents">MCP and Agent Skills guide</A>.
      </p>
    </BlogArticle>
  );
}
