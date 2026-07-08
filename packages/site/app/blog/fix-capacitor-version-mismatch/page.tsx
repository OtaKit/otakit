import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('fix-capacitor-version-mismatch')!;

export const metadata = blogPostMetadata(post.slug);

export default function VersionMismatchPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Capacitor&apos;s core, CLI, and plugins are versioned together, and they don&apos;t appreciate
        being out of step. A mismatch shows up as build failures, runtime plugin errors, or a warning from{' '}
        <Code>npx cap doctor</Code> &mdash; and it&apos;s often the hidden cause behind errors that look
        like something else entirely. This guide covers how to spot and fix Capacitor version mismatches.
      </p>

      <Callout>
        <p>
          Start with the diagnosis command: <Code>npx cap doctor</Code> prints the installed Capacitor
          versions and flags mismatches. Run it first &mdash; it turns a guessing game into a checklist.
        </p>
      </Callout>

      <h2>What has to agree</h2>
      <ul>
        <li><Code>@capacitor/core</Code>, <Code>@capacitor/cli</Code>, <Code>@capacitor/ios</Code>, <Code>@capacitor/android</Code> should share the same major version.</li>
        <li>Official plugins (<Code>@capacitor/*</Code>) should target that same major.</li>
        <li>Community plugins should declare compatibility with your Capacitor major.</li>
      </ul>

      <h2>Fix: align everything to one major</h2>
      <Pre>{`npx cap doctor          # see the mismatch
npm install @capacitor/core@latest @capacitor/cli@latest \\
  @capacitor/ios@latest @capacitor/android@latest
npx cap sync`}</Pre>
      <p>
        Then update your plugins to versions that support that major. If a community plugin has no
        compatible release, that&apos;s your blocker &mdash; and a candidate for replacement.
      </p>

      <h2>The native side</h2>
      <p>
        After aligning the npm packages, run <Code>npx cap sync</Code> so the native projects pick up the
        new versions. A mismatch that persists after sync usually means a plugin&apos;s native code is
        pinned to an incompatible SDK &mdash; check its docs for the required Capacitor version.
      </p>

      <h2>How this relates to OTA</h2>
      <p>
        Capacitor version alignment is a <em>native</em> concern, but it has an OTA parallel: your web
        bundle assumes a certain native runtime. OtaKit&apos;s <strong>runtime version</strong> is how you
        stop a bundle from reaching a native shell it&apos;s incompatible with &mdash; the same
        &ldquo;these two have to agree&rdquo; discipline, applied to over-the-air updates. See{' '}
        <A href="/blog/semantic-versioning-for-ota-bundles">semantic versioning for bundles</A>.
      </p>

      <Callout>
        <p>
          Pin your Capacitor versions in <Code>package.json</Code> rather than floating them. Surprise
          minor bumps from a loose range are a common way a working project starts throwing mismatch errors
          overnight.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/upgrade-capacitor-7-to-8">upgrading Capacitor 7 to 8</A> for a clean major bump
        and <A href="/blog/fix-capacitor-android-build-errors">Android build errors</A> for what mismatches
        often trigger downstream.
      </p>
    </BlogArticle>
  );
}
