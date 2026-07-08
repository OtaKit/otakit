import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('android-16kb-page-size-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function PageSize16kPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Google Play now requires apps to support 16&nbsp;KB memory page sizes, and the failure mode is
        nasty: your app builds fine, passes review superficially, then crashes on 16&nbsp;KB devices
        because one native library was compiled for 4&nbsp;KB alignment. In a Capacitor app the culprit is
        almost always a plugin&apos;s native <Code>.so</Code>. This guide covers finding it and fixing it.
      </p>

      <Callout>
        <p>
          This is a <strong>native library</strong> problem &mdash; your web bundle is irrelevant to it.
          Fixing it means a rebuilt binary and a store update; after that, <A href="/">OtaKit</A> keeps
          the web layer flowing over the air as usual.
        </p>
      </Callout>

      <h2>Why 16KB matters now</h2>
      <p>
        Newer Android devices use 16&nbsp;KB memory pages for performance. Native code aligned only to
        4&nbsp;KB can crash on them. Google Play enforces 16&nbsp;KB support for new submissions, so a
        single misaligned <Code>.so</Code> in a dependency blocks your release.
      </p>

      <h2>Find the problem plugin</h2>
      <p>
        Inspect the native libraries in your built APK/AAB for alignment. Unzip the artifact and check the
        <Code> lib/arm64-v8a/</Code> shared objects &mdash; Android&apos;s alignment check tooling (and
        recent AGP) will flag the ones not built for 16&nbsp;KB. The offending path usually points straight
        at the plugin that bundled it.
      </p>
      <Pre>{`# inspect an AAB/APK for unaligned native libs
unzip -l app-release.aab | grep '\\.so$'`}</Pre>

      <h2>Fix it</h2>
      <ol>
        <li>
          <strong>Update the plugin.</strong> Maintainers have been rebuilding native libs with 16&nbsp;KB
          alignment; the newest version usually just fixes it.
        </li>
        <li>
          <strong>Update the underlying SDK.</strong> If the plugin wraps a third-party SDK (analytics,
          maps, ML), the misaligned lib may come from that SDK &mdash; bump it.
        </li>
        <li>
          <strong>Replace it.</strong> If it&apos;s unmaintained and no fixed build exists, swap the plugin
          for one that supports 16&nbsp;KB.
        </li>
      </ol>

      <h2>Verify before you submit</h2>
      <p>
        Test on a 16&nbsp;KB emulator image or device and confirm the app launches and exercises the
        plugin&apos;s feature without crashing. Don&apos;t rely on the build passing &mdash; the crash is a
        runtime one.
      </p>

      <Callout>
        <p>
          Audit your plugin list proactively. The apps that got surprised by this requirement are the ones
          carrying old native dependencies they&apos;d stopped thinking about &mdash; exactly the
          dependencies most likely to be misaligned.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/fix-capacitor-agp-9-build-errors">AGP 9 build errors</A> and{' '}
        <A href="/blog/fix-capacitor-android-build-errors">resolving Android build errors</A> for related
        native-build issues.
      </p>
    </BlogArticle>
  );
}
