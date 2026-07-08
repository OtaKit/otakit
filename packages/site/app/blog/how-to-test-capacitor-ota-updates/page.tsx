import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('how-to-test-capacitor-ota-updates')!;

export const metadata = blogPostMetadata(post.slug);

export default function TestOtaPage() {
  return (
    <BlogArticle post={post}>
      <p>
        The whole point of over-the-air updates is speed &mdash; but shipping an untested bundle to
        production is how speed turns into an incident. The fix isn&apos;t to slow down; it&apos;s to
        have a repeatable way to test an update on a real device before it reaches users. This guide
        lays out that loop with <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          Mental model: test the <em>same bundle</em> you&apos;ll release, on a real device, through
          the real update path &mdash; then promote that exact bundle. Never rebuild between testing
          and shipping.
        </p>
      </Callout>

      <h2>1. Use a staging channel</h2>
      <p>
        Channels let you release to an audience that isn&apos;t production. Point your test build (or
        your own device) at a <Code>staging</Code> channel and release there first:
      </p>
      <Pre>{`otakit upload --release staging`}</Pre>
      <p>
        Assign a device to the channel at runtime for ad-hoc testing, or bake it into a dedicated
        test build:
      </p>
      <Pre>{`import { OtaKit } from "@otakit/capacitor-updater";

await OtaKit.setChannel({ channel: "staging" });`}</Pre>

      <h2>2. Verify the update actually applies</h2>
      <p>
        Install the current store build on a real device, then release to staging and confirm the
        new bundle downloads and activates according to your update policy. Watch for three things:
      </p>
      <ul>
        <li>The device picks up the new bundle (check your version indicator in-app).</li>
        <li>
          It activates when you expect &mdash; silently on next cold start by default, or on a
          restart prompt if you use foreground UX. See{' '}
          <A href="/blog/background-vs-foreground-app-updates">background vs foreground updates</A>.
        </li>
        <li>
          Your app calls <Code>notifyAppReady()</Code> and the bundle sticks &mdash; if it rolls back,
          the new bundle failed to boot.
        </li>
      </ul>

      <h2>3. Deliberately test rollback</h2>
      <p>
        The most valuable test is the one everyone skips: prove that a broken bundle rolls back.
        Temporarily ship a bundle to staging that throws before <Code>notifyAppReady()</Code>, and
        confirm the device returns to the previous known-good version on its own. Once you&apos;ve
        seen rollback work with your own eyes, you&apos;ll trust production releases a lot more. Read{' '}
        <A href="/blog/capacitor-ota-rollback-strategies">rollback strategies</A> for the full
        picture.
      </p>

      <h2>4. Check native compatibility</h2>
      <p>
        A bundle that calls native code the installed shell doesn&apos;t have will break at runtime.
        Test the update against the same store build your users are on &mdash; not a fresh local
        build with newer plugins. OtaKit warns at upload time when it detects a dependency mismatch,
        and <Code>runtimeVersion</Code> keeps incompatible bundles from reaching old shells.
      </p>

      <h2>5. Promote the exact bundle</h2>
      <p>
        Once staging looks good, promote the same bundle id to production &mdash; don&apos;t rebuild,
        or you&apos;re shipping something you didn&apos;t test:
      </p>
      <Pre>{`otakit release <bundle-id> --channel production`}</Pre>

      <Callout>
        <p>
          A five-minute staging pass plus a rollback test turns &ldquo;I hope this works&rdquo; into
          &ldquo;I watched this work.&rdquo; That&apos;s the difference between fast and reckless.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Combine this with <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged
        rollouts</A> for production, and see the{' '}
        <A href="/docs/channels">channels docs</A> for the full channel API.
      </p>
    </BlogArticle>
  );
}
