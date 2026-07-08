import { BlogArticle, Callout, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-ota-hosting-options-compared')!;

export const metadata = blogPostMetadata(post.slug);

export default function HostingOptionsPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Once you&apos;ve decided to ship Capacitor updates over the air, the next question is where the
        bundles actually live and who serves them. There are three realistic answers &mdash; a managed
        service, a self-hosted server, or a fully roll-your-own setup on a CDN &mdash; and they differ a
        lot on cost, reliability, and how much of your weekend they consume. Here&apos;s the honest
        comparison, with <A href="/">OtaKit</A> as the static-CDN option.
      </p>

      <h2>The three options</h2>
      <DataTable
        headers={['Option', 'You operate', 'Best when']}
        rows={[
          ['Managed service', 'Nothing — vendor hosts delivery + control plane', 'You want zero infra and predictable behavior'],
          ['Self-hosted', 'Storage, CDN, and control plane on your infra', 'Compliance, data residency, or control rules'],
          ['Roll your own', 'Everything, including the update logic', 'You have unusual needs and time to maintain it'],
        ]}
      />

      <h2>Managed</h2>
      <p>
        The vendor hosts both the delivery and the control plane; you cut releases with a CLI and never
        think about infrastructure. The thing to check is the <strong>pricing model</strong>: many
        managed services meter monthly active users or bandwidth, so your bill grows with your install
        base. OtaKit&apos;s managed offering is CDN-direct with no MAU or bandwidth metering &mdash;
        most apps pay $0&ndash;25/mo. See{' '}
        <A href="/blog/capgo-alternative">the pricing math vs Capgo</A>.
      </p>

      <h2>Self-hosted</h2>
      <p>
        You run the control plane and serve bundles from your own storage and CDN. This is the right
        call for data-residency and compliance requirements. The feasibility depends entirely on the
        delivery model: because OtaKit serves a <strong>static signed manifest</strong> per
        <code> (app, channel, runtimeVersion)</code> lane rather than a dynamic per-device endpoint,
        self-hosting is object storage plus a CDN &mdash; not a request-per-launch backend. See{' '}
        <A href="/blog/self-hosted-capacitor-live-updates">self-hosted live updates</A>.
      </p>

      <h2>Roll your own</h2>
      <p>
        You <em>can</em> host static bundles on a CDN and write your own update-check logic in the app.
        People do this and it works &mdash; until you need the parts that are easy to underestimate:
        signed manifests, hash verification, atomic activation, automatic rollback, delta assembly, and
        runtime-version compatibility. That&apos;s a real project to build and maintain safely. Most
        teams reach for it, discover the edge cases, and adopt a purpose-built tool.
      </p>

      <Callout>
        <p>
          The hidden cost in roll-your-own is <strong>safety</strong>, not delivery. Serving a zip from
          a CDN is trivial. Guaranteeing a bad bundle can&apos;t brick the app &mdash; and recovers
          automatically when it does &mdash; is the hard part, and it&apos;s exactly what you don&apos;t
          want to get wrong on production devices.
        </p>
      </Callout>

      <h2>How to choose</h2>
      <ul>
        <li><strong>Just want it to work:</strong> managed, no metering.</li>
        <li><strong>Compliance/control:</strong> self-hosted the same open-source stack.</li>
        <li><strong>Genuinely unusual needs + time:</strong> roll your own, but budget for the safety features.</li>
      </ul>

      <h2>Where to go next</h2>
      <p>
        Read <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A> to see what any hosting
        option has to get right, then <A href="/docs/self-host">self-host docs</A> if you&apos;re going
        that route.
      </p>
    </BlogArticle>
  );
}
