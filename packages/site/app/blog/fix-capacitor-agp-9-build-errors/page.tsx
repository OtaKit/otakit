import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('fix-capacitor-agp-9-build-errors')!;

export const metadata = blogPostMetadata(post.slug);

export default function Agp9Page() {
  return (
    <BlogArticle post={post}>
      <p>
        Upgraded to Android Gradle Plugin 9 and your Capacitor build suddenly fails with namespace or
        <Code>compileSdk</Code> errors on a plugin that worked yesterday? AGP 9 tightened several
        requirements that older Capacitor plugins didn&apos;t meet. This guide covers what actually breaks
        and the fastest way to get your Android build green again.
      </p>

      <Callout>
        <p>
          These are <strong>native build</strong> errors, so the fix ships in your next store binary, not
          over the air. Once you&apos;re building again, <A href="/">OtaKit</A> keeps shipping the web
          layer without further store trips.
        </p>
      </Callout>

      <h2>The usual failures</h2>
      <ul>
        <li>
          <strong>Missing namespace</strong> &mdash; AGP 9 requires every module to declare a{' '}
          <Code>namespace</Code> in its <Code>build.gradle</Code>; the old <Code>package</Code> attribute
          in the manifest is no longer accepted.
        </li>
        <li>
          <strong>compileSdk / minSdk floors</strong> &mdash; AGP 9 raises the minimums; a plugin pinned
          low won&apos;t compile.
        </li>
        <li>
          <strong>Removed/renamed Gradle APIs</strong> &mdash; older plugin Gradle scripts calling
          deprecated APIs break outright.
        </li>
      </ul>

      <h2>Fix 1: update the plugins</h2>
      <p>
        The clean fix is upgrading the offending plugins to versions that support AGP 9 &mdash; maintainers
        have largely shipped these. Align your Capacitor core, CLI, and plugins to compatible versions
        first; a version mismatch masquerades as an AGP error surprisingly often. See{' '}
        <A href="/blog/fix-capacitor-version-mismatch">fixing version mismatch errors</A>.
      </p>

      <h2>Fix 2: add the namespace</h2>
      <p>
        If a plugin is unmaintained, you can patch its module to add a namespace:
      </p>
      <Pre>{`android {
  namespace "com.example.theplugin"
  compileSdk 35
}`}</Pre>

      <h2>Fix 3: bump the SDK floors</h2>
      <p>
        Raise <Code>compileSdk</Code> (and <Code>minSdk</Code> if needed) in your app-level
        <Code> build.gradle</Code> and variables file to meet AGP 9&apos;s requirements, then re-sync.
      </p>

      <Callout>
        <p>
          If a single unmaintained plugin is holding back the whole build, that&apos;s a signal to replace
          it. A stuck native dependency you can&apos;t update becomes the thing that blocks every future
          Android release.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/fix-capacitor-android-build-errors">resolving Android build errors</A> for the
        broader triage and <A href="/blog/android-16kb-page-size-capacitor">the 16KB page-size
        requirement</A>, another recent Android gotcha.
      </p>
    </BlogArticle>
  );
}
