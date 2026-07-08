import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('monitor-capacitor-ota-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function MonitorPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Shipping an update you can&apos;t observe is shipping blind. The whole point of over-the-air
        updates is speed and safety, and safety depends on knowing whether the last release actually
        landed &mdash; downloaded, activated, and booted &mdash; or quietly failed on a slice of
        devices. This guide covers what to monitor for Capacitor live updates and how to wire it up with{' '}
        <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          The single most important signal is the ratio of <strong>updates applied</strong> to{' '}
          <strong>updates that rolled back or failed</strong>. If that ratio moves the wrong way after
          a release, you have a bad bundle in the wild &mdash; catch it before it spreads.
        </p>
      </Callout>

      <h2>The events worth tracking</h2>
      <p>
        The plugin emits lifecycle events you can subscribe to and forward to your analytics or logging
        backend:
      </p>
      <Pre>{`import { OtaKit } from '@otakit/capacitor-plugin';

OtaKit.addListener('updateAvailable', (info) => track('ota_available', info));
OtaKit.addListener('downloaded', (info) => track('ota_downloaded', info));
OtaKit.addListener('downloadFailed', (info) => track('ota_download_failed', info));
OtaKit.addListener('updateApplied', (info) => track('ota_applied', info));
OtaKit.addListener('rollback', (info) => track('ota_rollback', info));`}</Pre>
      <p>
        Send these wherever you already collect product analytics. The names map to the delivery
        lifecycle: available &rarr; downloaded &rarr; applied is the happy path; downloadFailed and
        rollback are your alarms. Full details in <A href="/docs/events">Events</A>.
      </p>

      <h2>Failure inspection</h2>
      <p>
        When a device does roll back, you want to know why. <Code>getLastFailure()</Code> returns the
        reason the last update attempt was rejected &mdash; a hash mismatch, a missing{' '}
        <Code>notifyAppReady()</Code>, or a runtime-version incompatibility &mdash; so you can
        distinguish &ldquo;bad bundle&rdquo; from &ldquo;bad network.&rdquo;
      </p>

      <h2>The metrics that should gate a rollout</h2>
      <ul>
        <li>
          <strong>Apply rate</strong> &mdash; of devices that saw the update available, how many
          successfully applied it. A healthy release climbs steadily.
        </li>
        <li>
          <strong>Rollback rate</strong> &mdash; should be near zero. Any spike after a release is your
          signal to halt promotion.
        </li>
        <li>
          <strong>Download failure rate</strong> &mdash; a proxy for bundle size and network fit;
          persistently high means consider <A href="/blog/delta-updates-explained-capacitor">delta updates</A>.
        </li>
      </ul>

      <Callout>
        <p>
          Pair monitoring with staged rollouts. If you release to a small channel first and watch these
          signals before promoting, a bad bundle is a non-event &mdash; see{' '}
          <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/plugin">Plugin API</A> for <Code>getState()</Code> and{' '}
        <Code>getLastFailure()</Code>, and <A href="/blog/debug-capacitor-ota-updates">debugging OTA
        updates</A> for turning a bad signal into a fix.
      </p>
    </BlogArticle>
  );
}
