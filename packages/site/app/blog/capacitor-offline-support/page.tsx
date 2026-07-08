import { BlogArticle, Callout, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-offline-support')!;

export const metadata = blogPostMetadata(post.slug);

export default function OfflineSupportPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Phones lose signal &mdash; in elevators, on planes, in the countryside, on a bad carrier. An app
        that shows a blank screen the moment the network drops feels broken. This guide covers building
        real offline support into a Capacitor app: detecting connectivity, caching the app shell, showing
        a clean offline state, and keeping <A href="/">OTA updates</A> working across connection drops.
      </p>

      <Callout>
        <p>
          Capacitor gives you a head start: the web bundle is already on the device, so your UI shell
          loads offline by default. The work is handling <em>data</em> gracefully when the network
          isn&apos;t there.
        </p>
      </Callout>

      <h2>1. Detect connectivity</h2>
      <p>
        Use the Network plugin to know the current state and react to changes:
      </p>
      <Pre>{`import { Network } from '@capacitor/network';

const status = await Network.getStatus();
Network.addListener('networkStatusChange', (s) => {
  setOnline(s.connected);
});`}</Pre>

      <h2>2. Show a real offline state, not an error</h2>
      <p>
        When offline, degrade gracefully: serve cached data, disable actions that need the network with a
        clear explanation, and show a small persistent indicator rather than a full-screen error. A good
        offline state tells the user &ldquo;you&apos;re offline, here&apos;s what still works.&rdquo;
      </p>

      <h2>3. Cache what matters</h2>
      <p>
        Persist the data the user needs most recently viewed content, their profile, queued actions to
        replay when the connection returns. Store it in the platform storage (and secrets in the keystore
        &mdash; see <A href="/blog/secure-token-storage-capacitor">secure token storage</A>).
      </p>

      <h2>4. OTA updates and offline coexist cleanly</h2>
      <p>
        This is where the OTA model helps rather than hurts. The device always keeps its current bundle,
        so losing the network mid-check never breaks the app &mdash; the update simply doesn&apos;t apply
        yet and retries when connectivity returns:
      </p>
      <Pre>{`import { OtaKit } from '@otakit/capacitor-plugin';

Network.addListener('networkStatusChange', (s) => {
  if (s.connected) OtaKit.check(); // resume the check when back online
});`}</Pre>
      <p>
        See <A href="/blog/ota-update-error-handling-ux">update error-handling UX</A> for why a failed
        check should stay silent.
      </p>

      <Callout>
        <p>
          Test airplane mode deliberately: toggle it mid-flow, mid-download, mid-update. The behaviors you
          discover there &mdash; and the fixes &mdash; are almost all web-layer, so you can ship them over
          the air as you harden the app.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/capacitor-background-tasks">background tasks</A> for syncing queued work, and{' '}
        <A href="/docs/events">Events</A> for the update lifecycle across reconnects.
      </p>
    </BlogArticle>
  );
}
