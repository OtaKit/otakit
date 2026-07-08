import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('fix-capacitor-android-build-errors')!;

export const metadata = blogPostMetadata(post.slug);

export default function AndroidBuildErrorsPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Android build failures in Capacitor tend to look scarier than they are. The error text is a wall of
        Gradle output, but the actual cause is almost always one of a handful of usual suspects. This guide
        is a triage checklist: the most common Capacitor Android build errors and a repeatable way to fix
        each one.
      </p>

      <Callout>
        <p>
          First move, every time: read the <em>first</em> error, not the last. Gradle prints a cascade, and
          the root cause is near the top. Then run <Code>./gradlew assembleDebug --stacktrace</Code> from
          the <Code>android/</Code> folder for the real message.
        </p>
      </Callout>

      <h2>1. Version mismatch</h2>
      <p>
        Misaligned Capacitor core/CLI/plugins is the most common hidden cause. Rule it out first with{' '}
        <Code>npx cap doctor</Code> &mdash; see{' '}
        <A href="/blog/fix-capacitor-version-mismatch">fixing version mismatch</A>.
      </p>

      <h2>2. Manifest merger conflicts</h2>
      <p>
        Two plugins declaring incompatible manifest attributes (min SDK, a permission, an activity) fail
        the merge. The error names the conflicting nodes &mdash; resolve with a <Code>tools:replace</Code>
        or by aligning the plugins.
      </p>

      <h2>3. Duplicate classes</h2>
      <p>
        Two dependencies bundling the same class (often an old support lib vs AndroidX). Find the duplicate
        with a dependency tree and exclude the stale one:
      </p>
      <Pre>{`./gradlew app:dependencies | grep -i theclass`}</Pre>

      <h2>4. SDK / build-tools not installed</h2>
      <p>
        A <Code>compileSdk</Code> or build-tools version your machine doesn&apos;t have. Install it via the
        SDK manager, or align <Code>compileSdk</Code> to a version you do have. This one bites CI constantly
        &mdash; the runner image lacks the SDK you assume.
      </p>

      <h2>5. AGP / Gradle incompatibility</h2>
      <p>
        The Android Gradle Plugin and Gradle wrapper versions have to be compatible. A bump to one without
        the other fails immediately &mdash; and AGP 9 in particular introduced new requirements, covered in{' '}
        <A href="/blog/fix-capacitor-agp-9-build-errors">AGP 9 build errors</A>.
      </p>

      <h2>The reset that fixes a surprising amount</h2>
      <Pre>{`cd android && ./gradlew clean
rm -rf ~/.gradle/caches   # nuclear option for corrupt caches
cd .. && npx cap sync`}</Pre>

      <Callout>
        <p>
          Reproduce CI failures locally by matching the CI&apos;s JDK and SDK versions. Half of
          &ldquo;works locally, fails in CI&rdquo; Android errors are just a different JDK or missing SDK
          package on the runner.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/github-actions-android-build-capacitor">building Android in GitHub Actions</A>
        {' '}for a reference CI setup and <A href="/docs/setup">Setup</A> for the baseline project config.
      </p>
    </BlogArticle>
  );
}
