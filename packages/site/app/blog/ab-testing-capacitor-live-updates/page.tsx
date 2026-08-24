import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('ab-testing-capacitor-live-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function ABTestingPage() {
  return (
    <BlogArticle post={post}>
      <p>
        A/B testing a mobile app used to mean two store submissions and a two-week wait to learn
        anything. With over-the-air updates you can run a real experiment in production and act on the
        result the same day. This guide covers two ways to A/B test a Capacitor app with{' '}
        <A href="/">OtaKit</A>: channel-level splits and in-bundle feature flags.
      </p>

      <h2>Approach 1: channel-level A/B</h2>
      <p>
        Put a slice of users on a channel carrying variant B while everyone else stays on A. Because
        your app chooses the channel at runtime, you control the split:
      </p>
      <Pre>{`import { OtaKit } from '@otakit/capacitor-plugin';

// deterministic 50/50 split by a stable user id hash
const inVariantB = hash(user.id) % 2 === 0;
await OtaKit.setChannel({ channel: inVariantB ? 'experiment-b' : 'production' });`}</Pre>
      <p>
        Release variant B to <Code>experiment-b</Code>, measure, and when a winner emerges, promote it
        to <Code>production</Code> for everyone. See{' '}
        <A href="/blog/target-ota-updates-to-specific-users">targeting users with channels</A>.
      </p>

      <h2>Approach 2: in-bundle feature flags</h2>
      <p>
        Ship both variants inside one bundle, gated by a flag, and assign users to a variant client-side.
        This keeps everyone on one channel and is simpler to reason about for UI-level experiments. The
        OTA angle is that you can flip the flag, add a variant, or kill the experiment with a new bundle
        &mdash; no store release. See{' '}
        <A href="/blog/feature-flags-in-capacitor-apps">feature flags in Capacitor apps</A>.
      </p>

      <Callout>
        <p>
          Rule of thumb: use <strong>channels</strong> when the variants differ enough that you&apos;d
          rather not carry both in every bundle; use <strong>flags</strong> for lightweight UI/copy
          experiments where both fit comfortably in one build.
        </p>
      </Callout>

      <h2>Measuring the result</h2>
      <p>
        An experiment is only as good as its instrumentation. Emit an event tagging each user&apos;s
        variant, then track your success metric per variant in whatever analytics you already use. The
        update lifecycle events (<Code>updateApplied</Code>, etc.) also let you confirm the variant
        actually reached the device &mdash; see <A href="/docs/events">Events</A> and{' '}
        <A href="/blog/monitor-capacitor-ota-updates">monitoring OTA updates</A>.
      </p>

      <h2>Promote the winner</h2>
      <p>
        When the data is clear, promotion is one command &mdash; you ship the winning bundle to
        production without rebuilding, and retire the losing variant. This close-the-loop speed is the
        real advantage of experimenting over the air. See{' '}
        <A href="/blog/automate-channel-promotion-ota">channel promotion</A>.
      </p>

      <h2>Where to go next</h2>
      <p>
        Combine this with <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A>
        {' '}so even the winning variant ramps up safely, and read{' '}
        <A href="/docs/channels">Channels &amp; runtime version</A> for the mechanics.
      </p>
    </BlogArticle>
  );
}
