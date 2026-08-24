import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('platform-specific-ota-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function PlatformSpecificPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Most of the time you ship one web bundle to both platforms and it just works &mdash; that&apos;s
        the whole appeal of Capacitor. But occasionally a fix or a feature only applies to iOS or only to
        Android: a platform-specific CSS quirk, a workaround for one WebView, a feature gated to one
        store. This guide covers when and how to target iOS vs Android with Capacitor live updates using{' '}
        <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          Reach for platform-specific updates rarely. If you can solve it with a runtime{' '}
          <Code>Capacitor.getPlatform()</Code> check inside one shared bundle, do that first &mdash;
          it&apos;s simpler and keeps both platforms on one release.
        </p>
      </Callout>

      <h2>Option 1: branch inside one bundle (preferred)</h2>
      <p>
        Ship the same bundle everywhere and branch at runtime. This keeps a single release stream and is
        almost always the right answer for small differences:
      </p>
      <Pre>{`import { Capacitor } from '@capacitor/core';

if (Capacitor.getPlatform() === 'ios') {
  applyIosWorkaround();
} else if (Capacitor.getPlatform() === 'android') {
  applyAndroidWorkaround();
}`}</Pre>
      <p>
        The change ships over the air to both platforms; each device runs its own branch. No extra
        channels, no divergence to manage.
      </p>

      <h2>Option 2: separate channels per platform</h2>
      <p>
        When the platforms genuinely diverge &mdash; different feature sets, different release cadences
        &mdash; give each its own channel. Configure iOS builds to follow <Code>production-ios</Code> and
        Android builds <Code>production-android</Code>, then release to each independently:
      </p>
      <Pre>{`otakit upload --release production-ios
otakit upload --release production-android`}</Pre>
      <p>
        This is more to manage &mdash; two streams to keep in sync &mdash; so use it only when the
        divergence is real. See <A href="/docs/channels">Channels &amp; runtime version</A>.
      </p>

      <h2>Watch the native compatibility boundary</h2>
      <p>
        Platform differences often trace back to different native shells. If your iOS and Android binaries
        ship different plugin versions, that&apos;s a <strong>runtime version</strong> concern, not just
        a channel one &mdash; a bundle should only reach shells it&apos;s compatible with. See{' '}
        <A href="/blog/semantic-versioning-for-ota-bundles">semantic versioning for bundles</A>.
      </p>

      <Callout>
        <p>
          The maintenance cost of two channels is the same as the cost of any fork: every future change
          has to consider both. Merge them back to a single channel as soon as the platform-specific
          reason goes away.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/target-ota-updates-to-specific-users">targeting users with channels</A> for
        the broader channel patterns and <A href="/docs/plugin">Plugin API</A> for platform detection.
      </p>
    </BlogArticle>
  );
}
