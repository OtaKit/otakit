import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('staged-rollouts-for-capacitor-live-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function StagedRolloutsPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Shipping a live update to every device at once is fast — and occasionally a fast way to take
        your whole user base down. A staged (or phased) rollout releases to a small slice first,
        lets you watch it in the wild, and only then promotes to everyone. If something looks wrong,
        you stop before it spreads.
      </p>
      <p>
        This guide shows how to run staged rollouts for Capacitor apps using channels and runtime
        versions, with <A href="/">OtaKit</A> as the example.
      </p>

      <Callout>
        <p>
          Mental model: a channel is an <em>audience</em> decision (who sees this bundle). A runtime
          version is a <em>compatibility</em> contract (which native shells can run it). Staged
          rollouts are mostly about the first.
        </p>
      </Callout>

      <h2>Why stage a rollout at all</h2>
      <p>
        OTA already gives you automatic rollback: a bundle that fails to boot rolls back on its own.
        But not every bad release crashes on launch. A broken checkout flow, a layout that only
        breaks on one device class, a subtle data bug — these boot fine and still hurt. Staging
        limits the blast radius of the failures rollback can&apos;t catch, and gives you real usage
        signal before you commit.
      </p>

      <h2>The channel-based pattern</h2>
      <p>
        The simplest reliable approach uses two channels: a small pre-production audience and
        production. You release the same bundle to the small channel first, watch, then promote the
        exact same bundle — not a rebuild — to production.
      </p>
      <ol>
        <li>
          Point internal users, beta testers, or a fraction of installs at a <Code>beta</Code>{' '}
          channel via the plugin config.
        </li>
        <li>
          Release to <Code>beta</Code> and let it soak for a defined window (an hour, a day — your
          call).
        </li>
        <li>Watch crash-free sessions, key funnels, and error rates for that cohort.</li>
        <li>Promote the same bundle to production, or hold and fix.</li>
      </ol>
      <Pre>{`# release to the small audience first
otakit upload --release beta

# looks healthy? promote the exact same bundle — no rebuild
otakit release <bundle-id> --channel production`}</Pre>
      <p>
        Promoting the same bundle id matters: you&apos;re shipping the artifact you already
        validated, byte for byte, not a fresh build that might differ.
      </p>

      <h2>Assigning devices to a channel</h2>
      <p>
        Set the channel in the plugin config for a static split (all beta builds on the beta
        channel), or move a device at runtime for opt-in beta programs:
      </p>
      <Pre>{`import { OtaKit } from "@otakit/capacitor-updater";

// e.g. behind a "Join the beta" toggle in settings
await OtaKit.setChannel({ channel: "beta" });`}</Pre>
      <p>
        For a percentage-based rollout, gate that assignment behind your own flag — assign a stable
        fraction of installs to <Code>beta</Code> and widen it as confidence grows. See{' '}
        <A href="/docs/channels">channels &amp; runtime version</A> for the full surface.
      </p>

      <h2>What to watch during the soak</h2>
      <ul>
        <li>
          <strong>Crash-free sessions</strong> for the cohort vs. baseline — the fastest red flag.
        </li>
        <li>
          <strong>notifyAppReady rate</strong> — if the new bundle boots cleanly, this stays high;
          a dip means devices are rolling back.
        </li>
        <li>
          <strong>Business funnels</strong> — the bugs rollback can&apos;t catch show up here.
        </li>
      </ul>

      <h2>When it goes wrong: stop and roll back</h2>
      <p>
        If the beta cohort looks bad, don&apos;t promote — and if a bad bundle already reached
        production, release the previous known-good bundle to the production channel. Because
        promotion is just pointing a channel at a bundle id, rolling forward to the old version is
        as fast as rolling out the new one was.
      </p>
      <Pre>{`# emergency: point production back at the last good bundle
otakit release <previous-bundle-id> --channel production`}</Pre>
      <p>
        For genuine emergencies where you need devices to update immediately rather than on next
        launch, releasing with <Code>--force-immediate</Code> makes them apply and reload on their
        next check. Use it sparingly — see <A href="/docs/update-strategies">update strategies</A>.
      </p>

      <Callout>
        <p>
          A staged rollout turns &ldquo;we shipped a bug to everyone&rdquo; into &ldquo;we caught a
          bug on the beta channel.&rdquo; Same speed, far less risk.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Combine this with <A href="/blog/capacitor-ota-update-security">a secure pipeline</A> and{' '}
        <A href="/blog/automate-capacitor-ota-releases-github-actions">automated releases</A>, and
        read <A href="/blog/common-capacitor-ota-mistakes">common OTA mistakes</A> to avoid the
        traps that make rollouts risky in the first place.
      </p>
    </BlogArticle>
  );
}
