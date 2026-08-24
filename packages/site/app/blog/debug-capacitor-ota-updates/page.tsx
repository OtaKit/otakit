import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('debug-capacitor-ota-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function DebugPage() {
  return (
    <BlogArticle post={post}>
      <p>
        You released a bundle and the app didn&apos;t change. Or it changed, then reverted. Live-update
        problems almost always trace to one of a handful of causes, and you can work through them in
        order. This is the checklist for debugging Capacitor OTA updates with{' '}
        <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          Start here: call <Code>getState()</Code> and <Code>getLastFailure()</Code> from the plugin.
          Together they tell you which bundle is active and why the last attempt was rejected &mdash;
          that answers most questions before you dig further.
        </p>
      </Callout>

      <h2>1. Is <Code>notifyAppReady()</Code> being called?</h2>
      <p>
        This is the number-one cause. After an update boots, your app must call{' '}
        <Code>notifyAppReady()</Code> to confirm it started successfully. If it doesn&apos;t &mdash;
        because of a crash on boot, or because you never added the call &mdash; OtaKit assumes the
        update is bad and rolls back on the next launch. An update that &ldquo;keeps reverting&rdquo; is
        almost always a missing ready signal. See{' '}
        <A href="/blog/capacitor-ota-rollback-strategies">rollback strategies</A>.
      </p>

      <h2>2. Does the runtime version match?</h2>
      <p>
        A bundle is only served to native shells it&apos;s compatible with. If you shipped a bundle that
        needs a newer native runtime than the installed binary, compatible devices get it and older ones
        correctly don&apos;t. Check the runtime version on the release against what&apos;s installed. See{' '}
        <A href="/blog/semantic-versioning-for-ota-bundles">semantic versioning for bundles</A>.
      </p>

      <h2>3. Is the device on the channel you released to?</h2>
      <p>
        Releasing to <Code>staging</Code> and testing a device configured for <Code>production</Code> is
        a classic. Confirm the channel in your config matches the channel in your release command.
      </p>

      <h2>4. Did the download actually complete?</h2>
      <p>
        Subscribe to <Code>downloadFailed</Code> and check <Code>getLastFailure()</Code>. A large bundle
        on a flaky network can fail mid-download; the device keeps the old bundle and retries later.
        Persistent failures are a size problem &mdash; enable{' '}
        <A href="/blog/delta-updates-explained-capacitor">delta updates</A>.
      </p>

      <h2>5. Does the bundle verify?</h2>
      <p>
        Every bundle is checked against the SHA-256 in the signed manifest before it activates. A hash
        mismatch means the served files don&apos;t match what was signed &mdash; usually a botched
        upload or a caching artifact. Re-release and confirm the manifest updated.
      </p>

      <Pre>{`import { OtaKit } from '@otakit/capacitor-plugin';

const state = await OtaKit.getState();
const failure = await OtaKit.getLastFailure();
console.log('active bundle', state, 'last failure', failure);`}</Pre>

      <Callout>
        <p>
          Debug on a <strong>staging channel</strong> against a real device before production. Most
          &ldquo;it works on my machine&rdquo; update bugs are really channel or runtime-version
          mismatches that a proper staging pass would have caught &mdash; see{' '}
          <A href="/blog/how-to-test-capacitor-ota-updates">how to test OTA updates</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/plugin">Plugin API</A> for the state and failure methods, and{' '}
        <A href="/blog/monitor-capacitor-ota-updates">monitoring OTA updates</A> to catch these in
        production automatically.
      </p>
    </BlogArticle>
  );
}
