import { BlogArticle, Callout, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('mobile-app-update-strategy-checklist')!;

export const metadata = blogPostMetadata(post.slug);

export default function UpdateStrategyChecklistPage() {
  return (
    <BlogArticle post={post}>
      <p>
        &ldquo;Ship an update&rdquo; sounds simple until it&apos;s 5pm on a Friday and you&apos;re
        deciding whether to push a fix to a million devices with no plan for what happens if it&apos;s
        wrong. A real update strategy answers those questions before you need them. Here&apos;s a
        complete checklist for how a Capacitor app should handle updates, with <A href="/">OtaKit</A> as
        the reference implementation.
      </p>

      <Callout>
        <p>
          The point of a strategy is that releasing becomes routine and reversible. If shipping feels
          scary, something on this list is missing.
        </p>
      </Callout>

      <h2>Cadence &mdash; how often you ship</h2>
      <ul>
        <li>Decide a default rhythm (continuous on merge, or batched) so releases are predictable.</li>
        <li>Have a separate <strong>emergency</strong> path for hotfixes &mdash; see <A href="/blog/deploy-hotfixes-capacitor-ota">deploy a hotfix in minutes</A>.</li>
        <li>Keep native store releases rare; ship the web layer over the air in between.</li>
      </ul>

      <h2>Channels &mdash; where updates flow</h2>
      <ul>
        <li>Set up dev/staging/production channels &mdash; see <A href="/blog/staging-environments-capacitor-channels">staging environments</A>.</li>
        <li>Validate on staging, then promote the same bundle &mdash; see <A href="/blog/automate-channel-promotion-ota">channel promotion</A>.</li>
        <li>Have a beta channel for opt-in users &mdash; see <A href="/blog/target-ota-updates-to-specific-users">targeting users</A>.</li>
      </ul>

      <h2>Rollout &mdash; how fast updates reach everyone</h2>
      <ul>
        <li>Use staged rollouts for anything non-trivial &mdash; see <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A>.</li>
        <li>Reserve force-immediate for genuine emergencies &mdash; see <A href="/blog/forced-and-mandatory-capacitor-updates">forced updates</A>.</li>
      </ul>

      <h2>Safety &mdash; what happens when it&apos;s wrong</h2>
      <ul>
        <li>Confirm <code>notifyAppReady()</code> is called so automatic rollback is armed.</li>
        <li>Know your manual rollback / roll-forward move &mdash; see <A href="/blog/capacitor-ota-rollback-strategies">rollback strategies</A>.</li>
        <li>Test updates on device before production &mdash; see <A href="/blog/how-to-test-capacitor-ota-updates">how to test</A>.</li>
      </ul>

      <h2>Versioning &mdash; keeping bundles compatible with shells</h2>
      <ul>
        <li>Use runtime versions to gate bundles to compatible native shells &mdash; see <A href="/blog/semantic-versioning-for-ota-bundles">semantic versioning</A>.</li>
        <li>Never ship a bundle that assumes a native capability older binaries lack.</li>
      </ul>

      <h2>Observability &mdash; knowing what happened</h2>
      <ul>
        <li>Track apply and rollback rates &mdash; see <A href="/blog/monitor-capacitor-ota-updates">monitoring</A>.</li>
        <li>Have a debugging runbook &mdash; see <A href="/blog/debug-capacitor-ota-updates">debugging OTA updates</A>.</li>
      </ul>

      <h2>Communication &mdash; telling users what changed</h2>
      <ul>
        <li>Keep changelogs for OTA releases &mdash; see <A href="/blog/capacitor-changelog-and-release-notes">changelogs and release notes</A>.</li>
        <li>Decide your update UX: silent vs prompt &mdash; see <A href="/blog/background-vs-foreground-app-updates">background vs foreground</A>.</li>
      </ul>

      <Callout>
        <p>
          Print this and check it against your current setup. Every unchecked box is a way a routine
          release can turn into an incident.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Start with <A href="/docs/update-strategies">update strategies</A>, then work through the linked
        posts for each area you haven&apos;t nailed down yet.
      </p>
    </BlogArticle>
  );
}
