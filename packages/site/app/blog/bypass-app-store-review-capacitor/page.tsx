import { BlogArticle, Callout, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('bypass-app-store-review-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function BypassReviewPage() {
  return (
    <BlogArticle post={post}>
      <p>
        &ldquo;How do I bypass App Store review?&rdquo; is one of the most-searched questions in mobile
        development, and it has a legitimate answer that isn&apos;t a hack: over-the-air updates let you
        push web-layer changes to a Capacitor app <strong>without waiting for another review</strong>. Not
        by sneaking around Apple and Google &mdash; by using a mechanism they explicitly allow. Here&apos;s
        exactly how it works and where the line is.
      </p>

      <Callout>
        <p>
          To be precise about the word: you&apos;re not bypassing the <em>first</em> review &mdash; your
          app still gets submitted and approved once. You&apos;re bypassing the review queue for every
          <em> subsequent</em> web-layer update. That&apos;s the part that&apos;s allowed.
        </p>
      </Callout>

      <h2>Why this is allowed, not a loophole</h2>
      <p>
        Both stores permit updating interpreted web code after approval. Apple&apos;s guideline 2.5.2
        carves out an explicit exception for code run by WebKit/JavaScriptCore; Google Play&apos;s policy
        restricts native executable code, not web assets. Your Capacitor JS/HTML/CSS falls on the allowed
        side of both. See <A href="/blog/does-apple-allow-live-updates">does Apple allow live updates</A>
        {' '}and <A href="/blog/does-google-allow-live-updates">does Google allow live updates</A>.
      </p>

      <h2>What you can ship without review</h2>
      <ul>
        <li>Bug fixes and hotfixes &mdash; see <A href="/blog/deploy-hotfixes-capacitor-ota">deploy a hotfix in minutes</A>.</li>
        <li>UI changes, copy, layout, styling.</li>
        <li>New screens and features built from your existing web stack.</li>
        <li>Feature-flag flips, A/B tests, config changes.</li>
      </ul>

      <h2>What still needs a review</h2>
      <ul>
        <li>New native plugins, permissions, or SDKs.</li>
        <li>Changes to the app&apos;s core purpose (the one thing the rules genuinely forbid).</li>
        <li>Anything you couldn&apos;t have submitted through the store originally.</li>
      </ul>

      <h2>How to actually do it</h2>
      <p>
        Add the plugin, ship one store binary, and from then on push web-layer changes over the air:
      </p>
      <Pre>{`otakit upload --release production`}</Pre>
      <p>
        The change reaches devices on their next check &mdash; minutes, not the days a review can take. See{' '}
        <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A> for the delivery model.
      </p>

      <Callout>
        <p>
          The one thing not to do: use OTA to push something review would have rejected. That&apos;s the
          behavior the rules exist to stop, and it&apos;s how apps get pulled. Ship the honest version of
          your app &mdash; just without the two-week tax on every fix.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/app-store-compliant-ota-updates">app-store-compliant OTA updates</A> for the
        full compliance picture and <A href="/docs/setup">Setup</A> to get started.
      </p>
    </BlogArticle>
  );
}
