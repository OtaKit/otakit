import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('target-ota-updates-to-specific-users')!;

export const metadata = blogPostMetadata(post.slug);

export default function TargetUsersPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Not every update should reach everyone at once. You might want a beta group on the newest build,
        a single customer on a hotfix you&apos;re validating, or an enterprise tenant pinned to a stable
        stream. This guide covers how to target Capacitor live updates to specific users and groups with{' '}
        <A href="/">OtaKit</A> &mdash; and the honest limits of a static-CDN model.
      </p>

      <Callout>
        <p>
          The primitive is the <strong>channel</strong>. A channel is a named update stream; put a
          device on a channel and it receives whatever you release there. Targeting is really
          &ldquo;which channel is this device on.&rdquo;
        </p>
      </Callout>

      <h2>Set a device&apos;s channel at runtime</h2>
      <p>
        Your app decides which channel a device follows &mdash; based on a user flag, a plan tier, an
        opt-in toggle, whatever you know about the user. Set it from the app:
      </p>
      <Pre>{`import { OtaKit } from '@otakit/capacitor-plugin';

// put beta opt-in users on the beta stream
if (user.isBetaTester) {
  await OtaKit.setChannel({ channel: 'beta' });
}`}</Pre>
      <p>
        Now a release to <Code>beta</Code> reaches exactly those users, and everyone else stays on{' '}
        <Code>production</Code>. See <A href="/docs/channels">Channels &amp; runtime version</A>.
      </p>

      <h2>Common targeting patterns</h2>
      <ul>
        <li>
          <strong>Beta group</strong> &mdash; opt-in users on a <Code>beta</Code> channel get releases
          early; you promote to <Code>production</Code> once they look good.
        </li>
        <li>
          <strong>Single customer / tenant</strong> &mdash; a dedicated channel for a customer who needs
          a specific build or a slower cadence.
        </li>
        <li>
          <strong>Plan tiers</strong> &mdash; route free vs paid users to different channels if their
          feature sets diverge.
        </li>
        <li>
          <strong>Internal / QA</strong> &mdash; a staging channel your team&apos;s devices follow.
        </li>
      </ul>

      <h2>The honest limits</h2>
      <p>
        Because OtaKit serves a static manifest per channel rather than computing a per-device response,
        targeting is channel-grained, not arbitrary-per-user. That&apos;s a deliberate trade: it&apos;s
        what keeps delivery cheap, CDN-cacheable, and self-hostable. For the vast majority of targeting
        needs &mdash; beta, tenant, tier, internal &mdash; channels are exactly the right tool. If you
        need truly per-individual server-side logic, that&apos;s the one thing a static model
        doesn&apos;t do, and it&apos;s worth being upfront about.
      </p>

      <Callout>
        <p>
          For feature-level targeting <em>within</em> a bundle &mdash; showing a feature to some users,
          not others, without a separate build &mdash; combine channels with{' '}
          <A href="/blog/feature-flags-in-capacitor-apps">feature flags</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/ab-testing-capacitor-live-updates">A/B testing with channels</A> and{' '}
        <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A> for two ways to
        use targeting in practice.
      </p>
    </BlogArticle>
  );
}
