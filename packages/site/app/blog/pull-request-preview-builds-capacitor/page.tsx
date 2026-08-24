import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('pull-request-preview-builds-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function PrPreviewPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Web teams get preview URLs for every pull request &mdash; a reviewer clicks a link and sees the
        change live. Mobile teams usually don&apos;t, so review happens against a diff or a description
        instead of the actual running app. With update channels you can give every PR an{' '}
        <strong>installable preview on a real device</strong>, and it&apos;s simpler than it sounds. This
        guide shows how with <A href="/">OtaKit</A> and CI.
      </p>

      <Callout>
        <p>
          The trick: a channel per PR. Testers install one preview build of your app once, then each PR
          publishes its web bundle to its own channel &mdash; switch channel, see that PR&apos;s change on
          your phone. No per-PR native build.
        </p>
      </Callout>

      <h2>1. A reusable preview binary</h2>
      <p>
        Ship your testers a single &ldquo;preview&rdquo; build of the app &mdash; internal distribution
        via TestFlight or Firebase App Distribution. It follows whatever channel you point it at, so you
        build it once and reuse it across every PR.
      </p>

      <h2>2. Publish each PR to its own channel</h2>
      <p>
        In your CI workflow, on every pull request, build the web app and release it to a channel named for
        the PR:
      </p>
      <Pre>{`# in the PR workflow
npm run build
otakit upload --release "pr-\${PR_NUMBER}"`}</Pre>
      <p>
        Now there&apos;s a live channel carrying exactly that PR&apos;s code. See{' '}
        <A href="/docs/ci">CI automation</A> for wiring it into your pipeline.
      </p>

      <h2>3. Reviewers switch to the PR channel</h2>
      <p>
        In the preview build, expose a way to enter a channel name (a debug screen). A reviewer types{' '}
        <Code>pr-123</Code>, the app switches, and they&apos;re running that PR:
      </p>
      <Pre>{`import { OtaKit } from '@otakit/capacitor-plugin';
await OtaKit.setChannel({ channel: 'pr-123' });`}</Pre>
      <p>
        See <A href="/blog/target-ota-updates-to-specific-users">targeting users with channels</A> for the
        switching mechanics.
      </p>

      <h2>4. Clean up merged PRs</h2>
      <p>
        When a PR merges or closes, delete its channel/release so old previews don&apos;t pile up. A
        <Code> otakit delete</Code> step in the close workflow keeps things tidy.
      </p>

      <Callout>
        <p>
          This changes review culture: instead of &ldquo;looks good in the diff,&rdquo; reviewers actually
          use the change on a device before approving. Bugs that only show up on real hardware get caught
          before merge, not after release.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/staging-environments-capacitor-channels">staging environments</A> for the
        broader channel model and <A href="/docs/channels">Channels &amp; runtime version</A> for the
        details.
      </p>
    </BlogArticle>
  );
}
