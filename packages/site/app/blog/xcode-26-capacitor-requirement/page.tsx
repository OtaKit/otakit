import { BlogArticle, Callout, Code, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('xcode-26-capacitor-requirement')!;

export const metadata = blogPostMetadata(post.slug);

export default function Xcode26Page() {
  return (
    <BlogArticle post={post}>
      <p>
        Apple periodically raises the minimum Xcode and SDK version it will accept for App Store
        submissions, and the Xcode 26 requirement is the latest bar. If your Capacitor app&apos;s CI is
        still building on an older Xcode, you&apos;ll hit a rejection at upload time &mdash; not build
        time, which makes it easy to miss until you&apos;re trying to ship. This guide covers what changes
        and how to update cleanly.
      </p>

      <Callout>
        <p>
          This is a <strong>native toolchain</strong> requirement. It affects the binary you submit, not
          the web layer. Once your builds are on the required Xcode, <A href="/">OtaKit</A> keeps shipping
          web-layer updates over the air regardless of Xcode version.
        </p>
      </Callout>

      <h2>What the requirement actually means</h2>
      <p>
        Apple requires new submissions to be built with a recent Xcode and linked against a recent iOS
        SDK. Miss it and App Store Connect rejects the upload with an SDK-version error. It doesn&apos;t
        change your Capacitor code &mdash; it changes the compiler and SDK you build with.
      </p>

      <h2>Update your local machine</h2>
      <p>
        Install the required Xcode from Apple, select it as active, and rebuild:
      </p>
      <ul>
        <li>Install Xcode 26 (or newer) from the App Store or Apple Developer downloads.</li>
        <li>Point the command line tools at it with <Code>xcode-select</Code>.</li>
        <li>Open your <Code>ios/</Code> project and confirm it builds against the new SDK.</li>
      </ul>

      <h2>Update your CI &mdash; the part people forget</h2>
      <p>
        The rejection usually surprises teams whose <em>CI</em> is pinned to an old macOS image with an
        old Xcode. Bump the runner image and the selected Xcode version in your workflow. Most CI providers
        expose a recent Xcode on their newest macOS images &mdash; select it explicitly rather than relying
        on the default. See <A href="/blog/github-actions-ios-build-signing">building and signing iOS in
        GitHub Actions</A> for where this fits.
      </p>

      <h2>Bump deployment targets if needed</h2>
      <p>
        A newer Xcode may drop support for very old iOS deployment targets. If your minimum iOS version is
        ancient, raise it to something the new toolchain supports &mdash; and check your plugins are happy
        with the new floor. See <A href="/blog/fix-capacitor-version-mismatch">fixing version mismatch</A>.
      </p>

      <Callout>
        <p>
          Keep a note of Apple&apos;s current Xcode/SDK requirement in your release runbook. These bars
          move on Apple&apos;s schedule, and the failure always lands at the worst time &mdash; when
          you&apos;re trying to ship.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/ci">CI automation</A> for keeping the toolchain current, and{' '}
        <A href="/blog/build-ios-app-from-windows-capacitor">building iOS from Windows</A> if you don&apos;t
        run a local Mac at all.
      </p>
    </BlogArticle>
  );
}
