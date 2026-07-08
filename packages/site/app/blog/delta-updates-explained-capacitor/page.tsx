import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('delta-updates-explained-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function DeltaUpdatesPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Here&apos;s a scenario that bites asset-heavy apps: you fix one line of JavaScript and ship
        an update &mdash; and every device re-downloads 40&nbsp;MB of images that didn&apos;t change.
        On a good connection it&apos;s wasteful; on a flaky mobile network it means failed and
        slow updates. Delta updates solve this by shipping only what actually changed. This guide
        explains how they work and when to turn them on in <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          Mental model: a full update ships the whole bundle every time. A delta update ships only
          the files that differ from what the device already has.
        </p>
      </Callout>

      <h2>How a normal update ships</h2>
      <p>
        By default, a release is a single zip of your entire web build. The device downloads it,
        verifies it against the SHA-256 hash in the signed manifest, and activates it. Simple and
        robust &mdash; but the download size is your whole bundle every time, regardless of how
        little changed.
      </p>

      <h2>How delta updates ship</h2>
      <p>
        With the <Code>deltas</Code> strategy, OtaKit uploads your build as per-file,
        content-addressed objects instead of one archive. Each device already has the files from its
        current bundle, so it downloads only the objects whose content changed between releases &mdash;
        typically your changed JavaScript and CSS, not the unchanged media.
      </p>
      <Pre>{`otakit upload --release --strategy deltas`}</Pre>
      <p>
        For an app carrying tens of megabytes of assets, that can turn a full-bundle download into a
        few hundred kilobytes &mdash; the difference between an update that reliably completes on a
        subway and one that doesn&apos;t.
      </p>

      <h2>Integrity is preserved</h2>
      <p>
        Deltas don&apos;t weaken security. Each object is content-addressed by its hash, and the
        assembled bundle is still verified against the signed manifest before it activates. A device
        can&apos;t assemble a bundle that doesn&apos;t match what your signing key vouched for. See{' '}
        <A href="/blog/capacitor-ota-update-security">OTA update security</A> for the full model.
      </p>

      <h2>When to use deltas</h2>
      <ul>
        <li>
          <strong>Use them</strong> if your bundle is large or asset-heavy, or your users are on
          constrained networks &mdash; the win scales with how much stays the same between releases.
        </li>
        <li>
          <strong>Less critical</strong> for tiny bundles where the whole thing is already a small
          download; the full-zip path is perfectly fine there.
        </li>
      </ul>

      <Callout>
        <p>
          A related lever: make the bundle smaller in the first place. Deltas and{' '}
          <A href="/blog/reduce-capacitor-app-bundle-size">bundle-size reduction</A> compound &mdash;
          smaller builds plus shipping only diffs.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/update-strategies">update strategies</A> for the flag details, and{' '}
        <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A> for where delta assembly
        fits in the delivery flow.
      </p>
    </BlogArticle>
  );
}
