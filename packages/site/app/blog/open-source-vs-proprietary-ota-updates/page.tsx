import { BlogArticle, Callout, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('open-source-vs-proprietary-ota-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function OpenSourceVsProprietaryPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Every live-update tool for Capacitor makes one foundational choice before any feature: is the
        stack open source, or is it a closed SaaS you rent? It shapes cost, lock-in, auditability, and
        whether you can ever run the thing yourself. This is an honest look at the tradeoff &mdash; and
        why <A href="/">OtaKit</A> ships fully MIT-licensed.
      </p>

      <h2>What actually differs</h2>
      <DataTable
        headers={['Dimension', 'Open source', 'Proprietary SaaS']}
        rows={[
          ['Self-hosting', 'Possible — you can run it yourself', 'Usually gated or unavailable'],
          ['Lock-in', 'Low — you own the format and can fork', 'High — your pipeline depends on them'],
          ['Auditability', 'Full — read the code that ships to devices', 'Trust the vendor'],
          ['Cost model', 'Often flat or usage-light', 'Frequently per-MAU / bandwidth metered'],
          ['Continuity', "Survives the vendor — code doesn't disappear", 'At risk if the company pivots or shuts down'],
        ]}
      />

      <Callout>
        <p>
          The continuity row is not hypothetical. Microsoft retired App Center and CodePush&apos;s
          hosted service; Ionic wound down Appflow. Teams on those platforms had to scramble. An
          open-source stack you can self-host doesn&apos;t vanish when a roadmap changes.
        </p>
      </Callout>

      <h2>Where proprietary still makes sense</h2>
      <p>
        Closed SaaS isn&apos;t automatically the wrong choice. If you want a fully managed experience,
        never intend to self-host, and the pricing fits your install base, a proprietary tool can be
        perfectly reasonable. The problems show up at scale: per-MAU or per-bandwidth metering means
        your bill grows with your success, and a closed format means migrating away is a project.
      </p>

      <h2>The code that ships to your users&apos; devices</h2>
      <p>
        There&apos;s a security dimension people underrate. An OTA tool literally pushes code to
        production devices. With an open-source stack you can read exactly how bundles are signed,
        verified, and activated &mdash; and confirm the update path does what it claims. With a closed
        one, you trust the vendor&apos;s description. For a security-sensitive surface, being able to
        audit the mechanism is worth a lot. See{' '}
        <A href="/blog/capacitor-ota-update-security">OTA update security</A>.
      </p>

      <h2>How OtaKit approaches it</h2>
      <ul>
        <li>
          <strong>Fully MIT.</strong> Plugin, CLI, and backend. Read it, fork it, run it.
        </li>
        <li>
          <strong>Real self-hosting</strong> &mdash; not an enterprise upsell. See{' '}
          <A href="/blog/self-hosted-capacitor-live-updates">self-hosted live updates</A>.
        </li>
        <li>
          <strong>No metering.</strong> CDN-direct delivery means cost doesn&apos;t scale with monthly
          active users.
        </li>
        <li>
          <strong>No lock-in.</strong> Static signed manifests are a format you own.
        </li>
      </ul>

      <Callout>
        <p>
          &ldquo;Open core&rdquo; is a middle ground worth naming: the client is open, the important
          server bits are not. It looks open until you try to self-host the part that matters. Check
          what&apos;s actually licensed, not just what&apos;s on GitHub.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        If open source is a hard requirement, start with{' '}
        <A href="/blog/self-hosted-capacitor-live-updates">self-hosting</A> and the{' '}
        <A href="/docs/self-host">self-host docs</A>. For the buyer&apos;s roundup, see{' '}
        <A href="/blog/best-ota-tools-for-capacitor-2026">the best OTA tools for Capacitor</A>.
      </p>
    </BlogArticle>
  );
}
