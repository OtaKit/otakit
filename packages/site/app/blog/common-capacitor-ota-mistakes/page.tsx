import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('common-capacitor-ota-mistakes')!;

export const metadata = blogPostMetadata(post.slug);

export default function CommonMistakesPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Over-the-air updates are simple to start and easy to get subtly wrong. The failures below
        are the ones that actually bite teams in production — none of them are exotic, and all of
        them are avoidable once you know to look. Here they are, worst first, with the fix.
      </p>

      <h2>1. Forgetting notifyAppReady()</h2>
      <p>
        This is the big one. OtaKit treats every freshly activated bundle as unproven and waits for
        your app to confirm it booted. If you never call <Code>notifyAppReady()</Code>, the device
        assumes the update failed and rolls back — so your update &ldquo;doesn&apos;t stick,&rdquo;
        even though nothing was actually broken. Call it once, after your app has mounted and
        rendered:
      </p>
      <Pre>{`import { OtaKit } from "@otakit/capacitor-updater";

await OtaKit.notifyAppReady();`}</Pre>
      <p>
        The flip side is a feature, not a bug: this same handshake is what makes a genuinely broken
        release roll back automatically instead of stranding users on a white screen.
      </p>

      <h2>2. Shipping to everyone at once</h2>
      <p>
        Auto-rollback catches bundles that crash on boot. It does not catch a broken checkout, a
        bad API call, or a layout that only fails on one device class — those boot fine and still
        cause damage. Releasing to 100% of users on every update means every such bug is a full-
        fleet incident. Use a beta channel first; see{' '}
        <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A>.
      </p>

      <h2>3. Breaking native compatibility</h2>
      <p>
        OTA moves the web layer only. If a bundle calls a Capacitor plugin the installed native
        shell doesn&apos;t have — because you added it in a store build that hasn&apos;t rolled out
        yet — it breaks on older installs. The fix is <Code>runtimeVersion</Code>: bump it whenever a
        store release changes native code, so each shell only receives bundles it can run. OtaKit
        warns at upload time when it detects a mismatch.
      </p>

      <Callout>
        <p>
          Rule of thumb: if a change touches <Code>ios/</Code>, <Code>android/</Code>, plugins,
          permissions, or the Capacitor version, it&apos;s a store release with a{' '}
          <Code>runtimeVersion</Code> bump — not an OTA update.
        </p>
      </Callout>

      <h2>4. Rebuilding instead of promoting</h2>
      <p>
        A common process smell: validating a bundle on a beta channel, then running a fresh build to
        release to production. The production artifact is now <em>different</em> from the one you
        tested. Promote the exact bundle id you validated instead:
      </p>
      <Pre>{`otakit release <bundle-id> --channel production`}</Pre>

      <h2>5. Trying to OTA things you can&apos;t</h2>
      <p>
        Native code, new permissions, entitlements, splash screens baked into the binary, and the
        Capacitor runtime itself cannot ship over the air — and shouldn&apos;t, because that&apos;s
        the exact line Apple and Google draw. Trying to force it leads to rejections or broken
        installs. Know what&apos;s OTA-able: everything in your web build; nothing native. See{' '}
        <A href="/blog/app-store-compliant-ota-updates">App Store-compliant OTA updates</A>.
      </p>

      <h2>6. Ignoring bundle size on asset-heavy apps</h2>
      <p>
        If your app carries large images or media, a full-zip update re-downloads all of it every
        release, even when only a line of JavaScript changed. On flaky mobile connections that
        means failed or slow updates. Switch on delta updates so devices download only the files
        that changed:
      </p>
      <Pre>{`otakit upload --release --strategy deltas`}</Pre>

      <h2>7. No token discipline in CI</h2>
      <p>
        Release automation is great until a token leaks. Don&apos;t hardcode credentials in
        workflow files or echo them to logs; inject a scoped token as a masked secret and rotate it
        when people leave. The <A href="/blog/automate-capacitor-ota-releases-github-actions">
          GitHub Actions guide
        </A>{' '}
        shows a safe setup.
      </p>

      <Callout>
        <p>
          The through-line: OTA is safe when a bad or malicious release degrades into a non-event.
          notifyAppReady, staged channels, runtimeVersion, and hash-verified bundles are the four
          controls that get you there.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Read <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A> for the full model,
        and <A href="/blog/capacitor-ota-update-security">OTA update security</A> to lock the
        pipeline down.
      </p>
    </BlogArticle>
  );
}
