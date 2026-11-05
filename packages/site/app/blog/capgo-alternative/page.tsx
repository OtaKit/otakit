import { BlogArticle, Callout, Code, DataTable, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capgo-alternative')!;

export const metadata = blogPostMetadata(post.slug);

const priceRows = [
  ['2,000 users, 2 releases/mo', '$0 (free tier)', '$7–12 (pay as you go or Solo)'],
  ['10,000 users, 2 releases/mo', '$10 (Starter)', '$33 (Maker)'],
  ['50,000 users, 4 releases/mo', '$25 (Pro)', '$83 (Team)'],
  ['500,000 users, 4 releases/mo', '$75 (Pro + overage)', '$208+ (Enterprise)'],
];

const featureRows = [
  ['Billing meters', 'One: updates delivered', 'Three: MAU + bandwidth + storage'],
  ['Delta updates', 'Yes — per-file, content-addressed', 'Yes'],
  ['End-to-end encryption', 'Yes — AES-256-GCM, your key', 'Yes'],
  ['Automatic rollback', 'Yes — notifyAppReady() handshake', 'Yes'],
  ['Runtime channel switching', 'Yes — setChannel()', 'Yes'],
  ['Emergency releases', 'Yes — --force-immediate', 'Yes'],
  ['AI-agent workflow', 'Local + remote MCP and open Agent Skill', 'MCP and open Agent Skills'],
  [
    'Update check',
    'Static signed manifest on the Cloudflare CDN',
    'Per-device call to Capgo’s API',
  ],
  ['End-user tracking', 'None — no device identification', 'Per-device (MAU metering requires it)'],
  ['Open source', 'Entire stack, MIT', 'Yes — plugin MPL-2.0, backend AGPL-3.0, self-hostable'],
  ['Beyond OTA', 'Release health charts', 'Native builds, store submission, release monitoring'],
  [
    'Release model',
    '5 concepts: app, bundle, release, channel, runtimeVersion',
    'Channels + device overrides + cloud defaults + version filters',
  ],
];

export default function CapgoAlternativePage() {
  return (
    <BlogArticle post={post}>
      <p>
        If you&apos;re evaluating Capgo — or already running it and watching the bill track your
        user growth — here&apos;s the direct comparison. OtaKit delivers the same core product, live
        updates for Capacitor apps, with a simpler architecture and a pricing model that comes out
        cheaper in every scenario below. This page shows the math.
      </p>

      <h2>The pricing difference is structural</h2>
      <p>
        Capgo prices by monthly active users, with bandwidth and storage allowances on each plan.
        Every active device counts every month — ship zero updates, pay the same. As of November
        2026, billed yearly, that&apos;s Solo $12/mo (2,000 MAU, 100&nbsp;GiB bandwidth), Maker $33
        (10K MAU), Team $83 (100K MAU), and Enterprise from $208 (1M MAU); month to month, the same
        plans are $14, $39, $99, and $249+. You can also pay as you go from $5 in credits (about
        $0.003 per MAU and $0.06 per GiB), with or without a plan, which also covers usage beyond a
        plan&apos;s caps.
      </p>
      <p>
        OtaKit bills on one meter: <strong>updates delivered</strong>. Free covers 5,000
        updates/month with unlimited apps and releases; Starter is $10/mo for 100,000 updates, and
        Pro is $25/mo (billed yearly) for 1 million, then $50 per additional million. No MAU count,
        no bandwidth meter, no storage meter.
      </p>
      <DataTable headers={['Your app', 'OtaKit', 'Capgo']} rows={priceRows} />
      <p>
        (Updates delivered ≈ active devices × releases they pick up, so these are conservative,
        every-user-gets-every-release estimates. Capgo&apos;s column is its cheapest option at each
        size, plans billed yearly; the pay-as-you-go figure assumes a 5&nbsp;MB bundle. Quiet months
        cost you nothing on OtaKit; on MAU billing they cost the same as busy ones.)
      </p>
      <p>
        The bandwidth meter deserves special attention. A 25&nbsp;MB web bundle shipped to a few
        thousand devices eats Solo&apos;s 100&nbsp;GiB allowance fast, and overage is billed per
        GiB. OtaKit has no bandwidth line item at all — delivery is CDN-direct, and delta updates
        shrink the payload to just the files that changed.
      </p>

      <h2>Better delivery architecture</h2>
      <p>
        OtaKit&apos;s devices pull manifests and bundles exclusively from Cloudflare&apos;s edge —
        no vendor origin in the request path. Delivery reliability is the CDN&apos;s, not a function
        of any one company&apos;s API uptime; downloads come from the nearest edge node worldwide;
        and because no device is ever individually metered, your users are never fingerprinted or
        tracked. Every update is verified against an ES256-signed manifest and a SHA-256 hash before
        it runs, activation is provisional until <Code>notifyAppReady()</Code> confirms a healthy
        boot, and broken releases roll back on-device automatically.
      </p>

      <h2>Feature for feature</h2>
      <DataTable headers={['', 'OtaKit', 'Capgo']} rows={featureRows} />
      <p>
        Capgo also publishes <A href="https://capgo.app/docs/cli/reference/mcp/">MCP tooling</A> and{' '}
        <A href="https://capgo.app/skills/">open Agent Skills</A>. The useful comparison is
        therefore not whether an agent can call the platform. OtaKit combines a project-aware local
        server, an account-aware remote server, and one open release playbook across inspection,
        upload, approval, event review, and revert. Judge both products on the workflow and controls
        you will actually use.
      </p>
      <p>
        Capgo&apos;s extra surface — per-device overrides, cloud channel defaults, device
        self-assignment — exists to route <em>users</em> inside the update transport. OtaKit takes
        the position that OTA should route <em>versions</em> and your product code should route
        users (feature flags), which is why its release model stays small enough to explain in one
        whiteboard pass. Fewer routing states on devices means fewer 2 a.m. surprises.
      </p>
      <p>
        Two scope differences to be clear about. Capgo also offers cloud native builds with store
        submission, and release monitoring (Capgo Observe). Its stack is open source too — the
        plugin under MPL-2.0 and the backend under AGPL-3.0 — and can be self-hosted. OtaKit is
        deliberately OTA-only, with release health charts built in, and MIT-licensed end to end — if
        you already have CI, you already have the rest, without paying an update vendor for it.
      </p>

      <Callout>
        <p>
          Bottom line: the same live updates, delivered from a stronger network, with zero user
          tracking and one predictable bill — $10–25/mo for most apps that pay Capgo $33–208+.
        </p>
      </Callout>

      <h2>Switching from Capgo</h2>
      <p>
        The concepts map almost one-to-one — <Code>defaultChannel</Code> becomes{' '}
        <Code>channel</Code>, <Code>notifyAppReady()</Code> keeps its name,{' '}
        <Code>setChannel()</Code> keeps its name, and Capgo&apos;s <Code>directUpdate</Code> timing
        options translate directly to OtaKit&apos;s launch and resume policies:
      </p>
      <Pre>{`npm uninstall @capgo/capacitor-updater
npm install @otakit/capacitor-updater

npm run build
otakit upload --release`}</Pre>
      <p>
        The <A href="/blog/migrate-from-capgo-and-capawesome">full migration guide</A> covers the
        exact config translation, the API mapping table, and a production cutover plan that keeps
        your existing install base updating safely while the new store build rolls out. Or start
        clean with the <A href="/docs/setup">ten-minute setup</A> and see it work first. If your
        release work happens in a coding agent, start with the{' '}
        <A href="/docs/agents">MCP and Agent Skills guide</A>.
      </p>
    </BlogArticle>
  );
}
