import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('ota-update-error-handling-ux')!;

export const metadata = blogPostMetadata(post.slug);

export default function ErrorHandlingPage() {
  return (
    <BlogArticle post={post}>
      <p>
        The best-handled update failure is one the user never notices. A dropped download, a bad bundle,
        a device that goes offline mid-check &mdash; none of these should ever leave someone staring at a
        broken screen. This guide covers the error-handling and UX patterns that make Capacitor live
        updates feel invisible, using <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          Design principle: an update failure should degrade to <em>the app the user already had</em>,
          never to a worse state. The old bundle keeps working; the new one simply doesn&apos;t apply
          yet.
        </p>
      </Callout>

      <h2>The failure modes to handle</h2>
      <ul>
        <li><strong>Download failed</strong> &mdash; network dropped or bundle too large to finish.</li>
        <li><strong>Verification failed</strong> &mdash; hash didn&apos;t match the signed manifest.</li>
        <li><strong>Boot failed</strong> &mdash; the new bundle crashed before <Code>notifyAppReady()</Code>.</li>
      </ul>
      <p>
        OtaKit handles all three conservatively by default: a bundle that doesn&apos;t download,
        doesn&apos;t verify, or doesn&apos;t signal ready never becomes the active bundle. Your job is to
        handle the UX around those events.
      </p>

      <h2>Listen and stay quiet</h2>
      <p>
        Subscribe to the lifecycle events, but resist the urge to surface most of them. A failed
        background download is not a user-facing error &mdash; it&apos;s a &ldquo;try again later&rdquo;
        for your code, not a dialog for the user:
      </p>
      <Pre>{`import { OtaKit } from '@otakit/capacitor-plugin';

OtaKit.addListener('downloadFailed', (info) => {
  // log it, retry later — do NOT alert the user
  reportToAnalytics('ota_download_failed', info);
});

OtaKit.addListener('rollback', (info) => {
  // the app self-healed; record it, stay silent
  reportToAnalytics('ota_rollback', info);
});`}</Pre>

      <h2>Retry, don&apos;t nag</h2>
      <p>
        Downloads fail transiently all the time on mobile. The right response is a quiet retry on the
        next check or app resume, not a prompt. Because the device keeps its working bundle in the
        meantime, there&apos;s no urgency &mdash; the update simply lands whenever the network cooperates.
      </p>

      <h2>When to actually tell the user</h2>
      <p>
        There is one case for a visible prompt: a <strong>mandatory</strong> update the app can&apos;t
        run without (a breaking API change, say). Then a clear &ldquo;update required&rdquo; screen is
        correct &mdash; see{' '}
        <A href="/blog/forced-and-mandatory-capacitor-updates">forced and mandatory updates</A>. For
        everything else, silence is the better UX. The tradeoffs of visible vs silent are in{' '}
        <A href="/blog/background-vs-foreground-app-updates">background vs foreground updates</A>.
      </p>

      <Callout>
        <p>
          Inspect <Code>getLastFailure()</Code> when you need to differentiate causes in your logs
          &mdash; a persistent verification failure is a release problem you must fix; repeated download
          failures are a size/network problem you can fix with{' '}
          <A href="/blog/delta-updates-explained-capacitor">deltas</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/events">Events</A> for the full listener set and{' '}
        <A href="/blog/monitor-capacitor-ota-updates">monitoring OTA updates</A> to turn these events
        into a health signal.
      </p>
    </BlogArticle>
  );
}
