import { BlogArticle, Callout, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-ota-use-cases')!;

export const metadata = blogPostMetadata(post.slug);

export default function OtaUseCasesPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Most people discover over-the-air updates because they need to fix a bug fast. But once the
        pipeline exists, it unlocks a lot more than emergency patches. Here are the real ways teams use
        Capacitor OTA updates in production &mdash; each with a link to how to do it with{' '}
        <A href="/">OtaKit</A>.
      </p>

      <h2>1. Emergency hotfixes</h2>
      <p>
        The obvious one: a critical bug is live and the store queue is too slow. Push a fix in minutes
        instead of days. See <A href="/blog/deploy-hotfixes-capacitor-ota">deploy a hotfix in minutes</A>.
      </p>

      <h2>2. Staged and gradual rollouts</h2>
      <p>
        Release to a small slice first, watch the health signals, then ramp to everyone &mdash; or roll
        back. Every release gets safer. See{' '}
        <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A>.
      </p>

      <h2>3. A/B testing and experiments</h2>
      <p>
        Run real experiments in production and act on the result the same day, instead of shipping two
        store builds and waiting. See{' '}
        <A href="/blog/ab-testing-capacitor-live-updates">A/B testing with live updates</A>.
      </p>

      <h2>4. Feature flags and dark launches</h2>
      <p>
        Ship code dark, flip it on remotely for a cohort, and control rollout without a release. See{' '}
        <A href="/blog/feature-flags-in-capacitor-apps">feature flags in Capacitor apps</A>.
      </p>

      <h2>5. Beta and tester channels</h2>
      <p>
        Give opt-in users the newest build early on a beta channel, then promote what works to everyone.
        See <A href="/blog/target-ota-updates-to-specific-users">targeting users with channels</A>.
      </p>

      <h2>6. Paywall and conversion optimization</h2>
      <p>
        The paywall is web-layer UI &mdash; iterate copy, layout, and pricing presentation continuously to
        grow revenue. See <A href="/blog/capacitor-in-app-purchases">in-app purchases</A>.
      </p>

      <h2>7. Seasonal content and config</h2>
      <p>
        Holiday themes, event banners, remote config values &mdash; push time-sensitive content on your
        schedule without a build. See <A href="/blog/schedule-capacitor-ota-updates">scheduling updates</A>.
      </p>

      <h2>8. Keeping up with platform changes</h2>
      <p>
        When a WebView update or OS change breaks something, patch the web layer immediately rather than
        racing a store review. See <A href="/blog/common-capacitor-ota-mistakes">common OTA mistakes</A>
        {' '}for what to watch.
      </p>

      <Callout>
        <p>
          The pattern across all of these: anything in your web layer becomes a same-day decision instead
          of a two-week release cycle. That shift &mdash; from &ldquo;batch it for the next release&rdquo;
          to &ldquo;ship it now&rdquo; &mdash; is the real value of OTA.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        New to the mechanics? Start with <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A>
        {' '}and the <A href="/blog/capacitor-live-updates-faq">live updates FAQ</A>.
      </p>
    </BlogArticle>
  );
}
