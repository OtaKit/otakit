import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('build-ios-app-from-windows-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function IosFromWindowsPage() {
  return (
    <BlogArticle post={post}>
      <p>
        You&apos;re on Windows (or Linux), you&apos;ve built a great Capacitor app, and the App Store
        wants a signed iOS binary that &mdash; officially &mdash; only Xcode on a Mac can produce. You
        don&apos;t need to buy a Mac. Cloud CI runners rent you a Mac for the few minutes a build takes.
        This guide covers shipping an iOS Capacitor app without owning Apple hardware, and iterating after
        with <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          Honest framing: you still need a Mac to compile iOS &mdash; you just rent one in the cloud per
          build instead of owning one. What you avoid is the hardware, not the requirement.
        </p>
      </Callout>

      <h2>The approach: CI macOS runners</h2>
      <p>
        GitHub Actions, Codemagic, and others provide macOS runners with Xcode preinstalled. You push your
        code; the runner checks it out, builds the iOS app, signs it, and uploads to App Store Connect. You
        never touch a physical Mac.
      </p>

      <h2>1. Develop and test everything else locally</h2>
      <p>
        On Windows you can build your web app, run it in the browser, and even build and test the{' '}
        <strong>Android</strong> app fully &mdash; Android Studio runs everywhere. Only the final iOS
        compile needs the cloud Mac.
      </p>

      <h2>2. Handle iOS signing in CI</h2>
      <p>
        The genuinely fiddly part is certificates and provisioning profiles on a runner. Store them as CI
        secrets and import them at build time &mdash; the exact pattern is in{' '}
        <A href="/blog/github-actions-ios-build-signing">building and signing iOS in GitHub Actions</A>.
      </p>

      <h2>3. Build and upload from the workflow</h2>
      <p>
        The runner runs the same commands you would on a Mac, then uploads the <Code>.ipa</Code> to App
        Store Connect. From Windows, your involvement is <Code>git push</Code>.
      </p>

      <h2>4. Then ship everything else over the air</h2>
      <p>
        Here&apos;s where it gets genuinely comfortable: after that first cloud-built binary is live, most
        of your changes are web-layer and go out over the air from your Windows machine &mdash; no runner,
        no Mac, no wait:
      </p>
      <Pre>{`otakit upload --release production`}</Pre>
      <p>
        You only trigger a cloud iOS build again when you change native code. Day to day, you develop and
        ship entirely from Windows.
      </p>

      <Callout>
        <p>
          This is a big deal for solo devs and Windows-first teams: the Mac requirement shrinks from
          &ldquo;buy hardware and build every release on it&rdquo; to &ldquo;a cloud runner for occasional
          native builds.&rdquo;
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/ci">CI automation</A> and{' '}
        <A href="/blog/github-actions-android-build-capacitor">the Android build guide</A> for the platform
        you can build locally.
      </p>
    </BlogArticle>
  );
}
