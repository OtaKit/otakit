import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('feature-flags-in-capacitor-apps')!;

export const metadata = blogPostMetadata(post.slug);

export default function FeatureFlagsPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Feature flags and over-the-air updates are a natural pair. OTA lets you ship code without a
        store release; feature flags let you decide <em>when</em> that code turns on &mdash; and for
        whom. Together they give a Capacitor app the release flexibility of a modern web app: ship
        dark, flip features remotely, run controlled rollouts, and kill a broken feature without a
        redeploy. This guide covers the patterns, using <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          Mental model: OTA moves the code onto the device; a feature flag decides whether that code
          is active. Decoupling &ldquo;shipped&rdquo; from &ldquo;on&rdquo; is what makes releases
          calm.
        </p>
      </Callout>

      <h2>Two ways to drive flags in a Capacitor app</h2>
      <ol>
        <li>
          <strong>Remote config from your API.</strong> The app fetches a flag payload on launch and
          gates features on it. Flags change instantly, independent of any code release.
        </li>
        <li>
          <strong>Channel-based flags via OTA.</strong> Use OtaKit channels to serve different
          bundles &mdash; or bundles with different baked-in defaults &mdash; to different audiences.
          Great for beta cohorts and staged feature exposure.
        </li>
      </ol>
      <p>Most teams combine both: OTA ships the feature; a runtime flag controls exposure.</p>

      <h2>Ship dark, then flip</h2>
      <p>
        Deploy the feature behind a flag that&apos;s off. The code is on every device via OTA, but
        invisible. When you&apos;re ready, flip the flag &mdash; no new release, no store wait:
      </p>
      <Pre>{`// simplest possible flag gate
const flags = await fetchFlags(); // your API or remote config

if (flags.newCheckout) {
  renderNewCheckout();
} else {
  renderLegacyCheckout();
}`}</Pre>

      <h2>Controlled rollouts with channels</h2>
      <p>
        For a feature you want to expose gradually, combine flags with{' '}
        <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A>. Serve the
        feature-on bundle to a <Code>beta</Code> channel, watch the metrics, then widen:
      </p>
      <Pre>{`import { OtaKit } from "@otakit/capacitor-updater";

// opt a device into the beta cohort
await OtaKit.setChannel({ channel: "beta" });`}</Pre>

      <h2>The kill switch</h2>
      <p>
        The most underrated benefit: turning a feature <em>off</em> instantly. If a newly enabled
        feature misbehaves, flip its flag back rather than scrambling to ship a fix. Paired with
        OTA&apos;s <A href="/blog/capacitor-ota-rollback-strategies">rollback strategies</A>, you have
        two independent safety levers &mdash; disable the feature, or roll back the bundle.
      </p>

      <h2>Keep flags tidy</h2>
      <ul>
        <li>Give every flag an owner and a removal date &mdash; dead flags become tech debt.</li>
        <li>Default new flags to off; make turning something on a deliberate act.</li>
        <li>
          Don&apos;t gate native capabilities on a flag &mdash; those still require a store release
          regardless of the flag. See{' '}
          <A href="/blog/app-store-compliant-ota-updates">what OTA can and can&apos;t change</A>.
        </li>
      </ul>

      <Callout>
        <p>
          Ship dark, roll out gradually, and keep a kill switch. That&apos;s the whole discipline
          &mdash; and OTA is what makes it possible on mobile without waiting on review.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/channels">channels &amp; runtime version</A> and{' '}
        <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A> for the
        rollout mechanics.
      </p>
    </BlogArticle>
  );
}
