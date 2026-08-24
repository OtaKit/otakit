import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-ota-rollback-strategies')!;

export const metadata = blogPostMetadata(post.slug);

export default function RollbackStrategiesPage() {
  return (
    <BlogArticle post={post}>
      <p>
        OTA updates are only as safe as their recovery story. If a bad bundle can strand users with
        no way back, the speed isn&apos;t worth it. Done right, a broken release becomes a non-event:
        the app recovers on its own, or you point everyone back to the last good version in seconds.
        Here are the three rollback strategies for Capacitor apps and when to use each &mdash; with{' '}
        <A href="/">OtaKit</A> as the example.
      </p>

      <Callout>
        <p>
          Mental model: OTA that can&apos;t roll back is a liability. The goal is that the worst
          case &mdash; a broken bundle &mdash; degrades into &ldquo;users stayed on the old version,&rdquo;
          not &ldquo;users are stuck on a white screen.&rdquo;
        </p>
      </Callout>

      <h2>The three strategies at a glance</h2>
      <DataTable
        headers={['Strategy', 'Catches', 'Who triggers it']}
        rows={[
          ['Automatic rollback', 'Bundles that fail to boot', 'The device, on its own'],
          ['Channel roll-forward', 'Bugs that boot fine but misbehave', 'You, by re-pointing a channel'],
          ['Manual device rollback', 'Edge cases, targeted recovery', 'Your code, via the plugin API'],
        ]}
      />

      <h2>1. Automatic rollback (the default safety net)</h2>
      <p>
        OtaKit keeps three bundles on device &mdash; current, fallback, and staged &mdash; and treats
        every freshly activated bundle as unproven. Your app confirms a successful boot with{' '}
        <Code>notifyAppReady()</Code>. If that call doesn&apos;t arrive within the ready window, the
        device assumes startup failed and reverts to the last known-good bundle by itself.
      </p>
      <Pre>{`import { OtaKit } from "@otakit/capacitor-updater";

// call once your app has booted and rendered
await OtaKit.notifyAppReady();`}</Pre>
      <p>
        This catches the scariest failure &mdash; a bundle that crashes on launch &mdash; with zero
        intervention. Forgetting <Code>notifyAppReady()</Code> is the most common OTA bug precisely
        because it makes good updates look like they roll back. See{' '}
        <A href="/blog/common-capacitor-ota-mistakes">common mistakes</A>.
      </p>

      <h2>2. Channel roll-forward (for bugs that boot fine)</h2>
      <p>
        Automatic rollback can&apos;t catch a bundle that starts cleanly but has a broken checkout or
        a bad API call. For those, roll <em>forward</em>: re-release the previous known-good bundle
        to the affected channel. Because a release is just pointing a channel at a bundle id,
        recovery is as fast as the rollout was.
      </p>
      <Pre>{`# point production back at the last good bundle
otakit release <previous-bundle-id> --channel production`}</Pre>
      <p>
        Keep a note of your last-known-good bundle id after each release so this is a ten-second
        action under pressure.
      </p>

      <h2>3. Manual device rollback (targeted recovery)</h2>
      <p>
        For edge cases &mdash; a support-driven fix, a specific device state &mdash; you can trigger a
        reset to the built-in bundle from your own code using the plugin API. This is the escape
        hatch, not the everyday tool.
      </p>

      <h2>How they work together</h2>
      <p>
        In practice you rely on all three: automatic rollback as the always-on floor, staged rollouts
        so channel roll-forward only ever affects a slice of users, and manual rollback for the rare
        targeted case. Layer them and there&apos;s no failure mode without a recovery.
      </p>

      <Callout>
        <p>
          The single highest-leverage habit: always call <Code>notifyAppReady()</Code>, and always
          <A href="/blog/staged-rollouts-for-capacitor-live-updates"> stage rollouts</A>. Those two
          cover the overwhelming majority of incidents.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/how-to-test-capacitor-ota-updates">how to test OTA updates</A> (including
        testing rollback deliberately) and <A href="/docs/update-strategies">update strategies</A>.
      </p>
    </BlogArticle>
  );
}
