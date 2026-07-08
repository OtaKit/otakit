import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('deploy-hotfixes-capacitor-ota')!;

export const metadata = blogPostMetadata(post.slug);

export default function HotfixPage() {
  return (
    <BlogArticle post={post}>
      <p>
        A critical bug is live. A payment button is broken, an API change took down a screen, a typo is
        costing conversions. The store review queue is measured in hours to days &mdash; far too slow.
        This is the scenario over-the-air updates exist for. Here&apos;s how to ship an emergency hotfix
        to a Capacitor app in minutes with <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          If the fix lives in your web layer &mdash; JavaScript, CSS, HTML, most business logic &mdash;
          you can ship it over the air right now. Only changes to native code, plugins, or permissions
          require a new store binary.
        </p>
      </Callout>

      <h2>The fast path</h2>
      <ol>
        <li>Fix the bug and build your web app as usual.</li>
        <li>
          Release it, forcing an immediate apply so devices don&apos;t wait for a later cold start:
          <Pre>{`otakit upload --release production --force-immediate`}</Pre>
        </li>
        <li>Watch it land. Devices pick up the bundle and apply it on their next check.</li>
      </ol>
      <p>
        The <Code>--force-immediate</Code> flag is the difference between &ldquo;fixed on next
        launch&rdquo; and &ldquo;fixed now.&rdquo; See{' '}
        <A href="/blog/forced-and-mandatory-capacitor-updates">forced and mandatory updates</A> for how
        immediate applies work.
      </p>

      <h2>Validate before you blast, even in a hurry</h2>
      <p>
        A hotfix that introduces a second bug is worse than the first. If you have even a few minutes,
        release to a staging channel and confirm the fix on a real device first, then promote the exact
        same bundle:
      </p>
      <Pre>{`otakit upload --release staging
# confirm the fix on device, then:
otakit upload --release production --force-immediate`}</Pre>

      <h2>Have a rollback ready</h2>
      <p>
        The reason you can move this fast safely is that a bad bundle isn&apos;t fatal. If the hotfix
        misbehaves, automatic rollback returns devices to the last known-good bundle when{' '}
        <Code>notifyAppReady()</Code> isn&apos;t reached, and you can roll the channel forward to a
        corrected build. See <A href="/blog/capacitor-ota-rollback-strategies">rollback strategies</A>.
      </p>

      <Callout>
        <p>
          Keep a hotfix runbook: the one-line release command, who can run it, and where to watch the
          rollback rate afterward. In an incident you want muscle memory, not documentation
          archaeology.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Read <A href="/blog/monitor-capacitor-ota-updates">monitoring</A> so you see the fix land, and{' '}
        <A href="/docs/update-strategies">update strategies</A> for the immediate-apply configuration.
      </p>
    </BlogArticle>
  );
}
