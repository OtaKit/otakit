import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('upgrade-capacitor-7-to-8')!;

export const metadata = blogPostMetadata(post.slug);

export default function UpgradeCap8Page() {
  return (
    <BlogArticle post={post}>
      <p>
        Major Capacitor upgrades are usually smoother than the version number suggests &mdash; the team is
        conservative about breaking changes &mdash; but &ldquo;usually&rdquo; isn&apos;t &ldquo;always,&rdquo;
        and the failures cluster in predictable places. This guide walks through upgrading a project from
        Capacitor 7 to 8, what to watch for, and how to keep your <A href="/">OTA</A> runtime version in
        sync.
      </p>

      <Callout>
        <p>
          Do this on a branch, and treat it as a native release. A major Capacitor bump changes the native
          projects, so it ships in a new store binary &mdash; not over the air.
        </p>
      </Callout>

      <h2>1. Bump the packages together</h2>
      <Pre>{`npm install @capacitor/core@8 @capacitor/cli@8 \\
  @capacitor/ios@8 @capacitor/android@8
npx cap sync`}</Pre>
      <p>
        Keep them on the same major &mdash; a mixed 7/8 install is the fastest way to a mismatch error. See{' '}
        <A href="/blog/fix-capacitor-version-mismatch">fixing version mismatch</A>.
      </p>

      <h2>2. Update the plugins</h2>
      <p>
        Update every <Code>@capacitor/*</Code> plugin to its version 8 release, and check community plugins
        for Capacitor 8 compatibility. A plugin with no v8-compatible release is your blocker &mdash;
        resolve it before going further.
      </p>

      <h2>3. Handle the breaking changes</h2>
      <p>
        Read the official 7&rarr;8 migration guide and apply its codemod/steps. Breaking changes typically
        touch minimum OS versions, a few renamed APIs, and native project settings. The upgrade tooling
        handles most of the mechanical edits; the manual part is your own code that used a changed API.
      </p>

      <h2>4. Raise the native floors if required</h2>
      <p>
        A new major often raises minimum iOS/Android versions and SDK levels. Update your deployment
        targets and <Code>compileSdk</Code> accordingly &mdash; this can interact with{' '}
        <A href="/blog/xcode-26-capacitor-requirement">the Xcode requirement</A> and{' '}
        <A href="/blog/fix-capacitor-agp-9-build-errors">AGP 9</A>.
      </p>

      <h2>5. Bump your OTA runtime version</h2>
      <p>
        Here&apos;s the OTA-specific step teams forget: the new binary is a new native runtime. Increment
        your OtaKit <strong>runtime version</strong> so bundles built for Capacitor 8 only reach the
        upgraded shells, and older shells keep getting compatible bundles until users update. See{' '}
        <A href="/blog/semantic-versioning-for-ota-bundles">semantic versioning for bundles</A>.
      </p>

      <Callout>
        <p>
          Test the full loop on a real device before submitting: fresh install of the new binary, then an
          OTA update on top of it. That confirms both the native upgrade and the runtime-version boundary
          in one pass.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/channels">Channels &amp; runtime version</A> for the compatibility boundary and{' '}
        <A href="/blog/how-to-test-capacitor-ota-updates">testing OTA updates</A> for the verification pass.
      </p>
    </BlogArticle>
  );
}
