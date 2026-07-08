import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('voltbuilder-alternative')!;

export const metadata = blogPostMetadata(post.slug);

export default function VoltBuilderAlternativePage() {
  return (
    <BlogArticle post={post}>
      <p>
        VoltBuilder solves a specific problem well: it compiles your Capacitor or Cordova web app
        into signed native binaries in the cloud, so you can ship to the App Store and Google Play
        without maintaining a Mac or an Android toolchain. What it doesn&apos;t do is{' '}
        <strong>over-the-air updates</strong>. This guide covers where VoltBuilder fits, and how{' '}
        <A href="/">OtaKit</A> adds the live-update layer on top.
      </p>

      <Callout>
        <p>
          These are complementary, not competing, tools. VoltBuilder produces the native binary you
          submit to the stores. OtaKit ships every web-layer change <em>after</em> that binary is
          installed &mdash; instantly, without another build or review.
        </p>
      </Callout>

      <h2>What VoltBuilder does and doesn&apos;t cover</h2>
      <ul>
        <li>
          <strong>Does:</strong> cloud native compilation, code signing, and packaging for iOS and
          Android from a web project.
        </li>
        <li>
          <strong>Doesn&apos;t:</strong> push a JS/CSS fix to already-installed apps. Every change
          means a fresh build and a store submission.
        </li>
      </ul>
      <p>
        That gap is the whole point of an OTA tool. Most of what a hybrid app iterates on &mdash; UI
        copy, layout, bug fixes, feature flags &mdash; lives in the web layer, and that&apos;s exactly
        what live updates can ship without a rebuild.
      </p>

      <h2>Adding live updates to a VoltBuilder workflow</h2>
      <p>
        Keep VoltBuilder for the binary. Add OtaKit for everything after:
      </p>
      <ol>
        <li>
          Install <Code>@otakit/capacitor-plugin</Code> and include it before you build your binary
          in VoltBuilder.
        </li>
        <li>
          Point the plugin at your OtaKit app and a channel (say <Code>production</Code>).
        </li>
        <li>
          After the binary is live, ship web changes with one command:
          <Pre>{`otakit upload --release production`}</Pre>
        </li>
      </ol>
      <p>
        From then on, only native changes &mdash; new plugins, permissions, SDK bumps &mdash; need a
        fresh VoltBuilder binary and a store review. Everything else goes over the air.
      </p>

      <h2>Why OtaKit for the OTA half</h2>
      <p>
        The same reasons that make VoltBuilder appealing &mdash; no local toolchain, predictable cost
        &mdash; apply to OtaKit&apos;s design: CDN-direct delivery from a static signed manifest, no
        MAU or bandwidth metering, delta updates, end-to-end encryption, and a fully open-source,
        self-hostable stack. See{' '}
        <A href="/blog/best-ota-tools-for-capacitor-2026">the best OTA tools for Capacitor</A> for the
        full comparison.
      </p>

      <Callout>
        <p>
          If you don&apos;t want a third-party build service at all, you can run the native builds in
          your own CI &mdash; see{' '}
          <A href="/blog/build-ios-app-from-windows-capacitor">build an iOS app from Windows</A> for
          the cloud-runner approach.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Start with <A href="/docs/setup">Setup</A>, then the{' '}
        <A href="/docs/cli">CLI reference</A>. To automate the release step alongside your builds, see{' '}
        <A href="/docs/ci">CI automation</A>.
      </p>
    </BlogArticle>
  );
}
