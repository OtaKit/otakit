import { BlogArticle, Callout, Code, DataTable, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capawesome-alternative')!;

export const metadata = blogPostMetadata(post.slug);

const priceRows = [
  ['1,000 users, 2 releases/mo', '$0 (free tier)', '$9 (Starter)'],
  ['10,000 users, 2 releases/mo', '$10 (Starter)', '$29 (Professional)'],
  ['50,000 users, 4 releases/mo', '$25 (Pro)', '$79 (Team)'],
  ['250,000 users, 4 releases/mo', '$25 (Pro)', '$249 (Business)'],
];

const featureRows = [
  ['Billing meter', 'Updates delivered', 'Monthly active users'],
  ['Free tier', '5,000 updates/mo, unlimited apps', '14-day trial'],
  ['Delta updates', 'Yes — per-file, content-addressed', 'Yes'],
  [
    'Bundle protection',
    'Signed manifests (ES256) + SHA-256, always on; optional AES-256-GCM E2E encryption',
    'Public-key signature verification',
  ],
  ['Automatic rollback', 'Yes — notifyAppReady() handshake', 'Yes (rollback protection)'],
  ['Runtime channel switching', 'Yes — setChannel()', 'Yes'],
  ['Emergency releases', 'Yes — --force-immediate', 'Manual sync control'],
  ['Native compatibility', 'Project-aware check before upload or release', 'Version restrictions'],
  [
    'AI-agent workflow',
    'Local + remote MCP and open Agent Skill',
    'Remote MCP and open Agent Skills',
  ],
  ['Device delivery path', '100% Cloudflare CDN edge', 'Vendor cloud'],
  ['End-user tracking', 'None — no device identification', 'Per-device (MAU metering requires it)'],
  [
    'Open source',
    'Entire stack, MIT — plugin, CLI, dashboard, server',
    'Plugin only; cloud is closed',
  ],
];

export default function CapawesomeAlternativePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Capawesome&apos;s Live Update plugin is a solid piece of engineering from a team the
        Capacitor community rightly respects. But if you&apos;re choosing an update platform — the
        service your releases depend on every day — OtaKit is the stronger and cheaper choice, and
        the reasons are concrete: no MAU caps, a fully open stack, CDN-direct delivery, and a bill
        that doesn&apos;t grow just because your app does.
      </p>

      <h2>The pricing gap, in numbers</h2>
      <p>
        Capawesome&apos;s live-update plans are gated by monthly active users: as of August 2026,
        $9/mo covers just 1,000 MAU, then $29 (10K), $79 (50K), and $249 (250K). Every active device
        counts every month, whether you release or not — and 1,000 MAU is small enough that a
        modestly successful side project outgrows the entry tier immediately.
      </p>
      <p>
        OtaKit meters updates delivered, nothing else. Free covers 5,000 updates/month with
        unlimited apps; Starter is $10/mo for 100,000, and Pro starts at $25/mo (billed yearly) for
        a million.
      </p>
      <DataTable headers={['Your app', 'OtaKit', 'Capawesome']} rows={priceRows} />
      <p>
        At 250,000 users the difference is $25 versus $249 — ten to one, every month, for the same
        job. And the OtaKit number doesn&apos;t move in months you don&apos;t ship.
      </p>

      <h2>Open source that actually means something</h2>
      <p>
        Capawesome open-sources the plugin; the cloud service behind it is closed. OtaKit&apos;s{' '}
        <strong>entire stack</strong> — Capacitor plugin, CLI, dashboard, and delivery
        infrastructure — is MIT-licensed in{' '}
        <A href="https://github.com/OtaKit/otakit">one repository</A>, and the self-hosted
        deployment is the same code we run hosted. You can audit every line that executes on your
        users&apos; devices and every line that serves them, and if we ever stop deserving your
        business, you take the stack and go. That exit right is the difference between a vendor and
        a dependency.
      </p>

      <h2>Stronger delivery, stricter safety</h2>
      <p>
        OtaKit devices download manifests and bundles exclusively from Cloudflare&apos;s global edge
        — vendor servers are never in the device path, so delivery reliability and latency are the
        CDN&apos;s, worldwide. Security is layered and always on: every manifest is ES256-signed,
        every download SHA-256-verified before it runs, and every activation is provisional until
        your app calls <Code>notifyAppReady()</Code> — no confirmation, the device rolls itself
        back. For code-sensitive apps, opt-in end-to-end encryption (AES-256-GCM, your key) means
        even OtaKit can&apos;t read your bundles.
      </p>
      <p>
        The OtaKit CLI also inspects native Capacitor dependencies before upload and compares them
        with the target release lane. That catches updates that need a new native shell while there
        is still time to route them through an app-store build.
      </p>

      <h2>Feature for feature</h2>
      <DataTable headers={['', 'OtaKit', 'Capawesome']} rows={featureRows} />
      <p>
        Capawesome publishes a <A href="https://capawesome.io/docs/ai/mcp/">remote MCP server</A>{' '}
        with cloud-management tools and{' '}
        <A href="https://capawesome.io/skills/">open Agent Skills</A>. The useful OtaKit distinction
        is the combination of local MCP for project inspection and uploads, remote MCP with scoped
        OAuth for account work, and one open Skill that carries its exact release options, approval
        points, event detail, and recovery flow. This is a workflow comparison, not a claim that
        Capawesome lacks agent integration.
      </p>
      <p>
        Scope note: Capawesome also sells cloud native builds and its Insider plugin SDKs, and if
        you&apos;re buying those anyway the bundle has logic. But for the update platform itself —
        the thing that has to be cheap, safe, and boring forever — OtaKit wins on price,
        architecture, and openness.
      </p>

      <Callout>
        <p>
          Bottom line: the same live updates with a stronger security pipeline, a fully MIT-licensed
          stack, and no user tracking — $10–25/mo for typical paid usage where Capawesome charges
          $29–249.
        </p>
      </Callout>

      <h2>Switching from Capawesome</h2>
      <p>
        The APIs map almost one-to-one: <Code>ready()</Code> becomes <Code>notifyAppReady()</Code>,{' '}
        <Code>sync()</Code> becomes <Code>update()</Code>, <Code>defaultChannel</Code> becomes{' '}
        <Code>channel</Code>, and the background auto-update strategy is OtaKit&apos;s default
        behavior out of the box:
      </p>
      <Pre>{`npm uninstall @capawesome/capacitor-live-update
npm install @otakit/capacitor-updater

npm run build
otakit upload --release`}</Pre>
      <p>
        The <A href="/blog/migrate-from-capgo-and-capawesome">full migration guide</A> has the
        complete config and API translation tables plus a safe production cutover plan. Or run the{' '}
        <A href="/docs/setup">ten-minute setup</A> on a test app first and watch an update land. To
        work through a coding agent, continue with the{' '}
        <A href="/docs/agents">MCP and Agent Skills guide</A>.
      </p>
    </BlogArticle>
  );
}
