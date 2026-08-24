import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-cli-commands-guide')!;

export const metadata = blogPostMetadata(post.slug);

export default function CapCliGuidePage() {
  return (
    <BlogArticle post={post}>
      <p>
        You&apos;ll run a handful of Capacitor CLI commands constantly and the rest almost never. This
        guide covers the ones that matter &mdash; what each does, when to run it, and the mistakes that
        cause &ldquo;my change isn&apos;t showing up&rdquo; &mdash; plus where the <A href="/">OtaKit</A>
        {' '}CLI fits alongside for live updates.
      </p>

      <h2>The commands you actually use</h2>
      <ul>
        <li><Code>npx cap add ios / android</Code> &mdash; create a native project. Run once per platform.</li>
        <li><Code>npx cap copy</Code> &mdash; copy your latest web build into the native projects.</li>
        <li><Code>npx cap sync</Code> &mdash; copy <em>and</em> update native dependencies. Run after installing a plugin.</li>
        <li><Code>npx cap open ios / android</Code> &mdash; open the native project in Xcode / Android Studio.</li>
        <li><Code>npx cap run ios / android</Code> &mdash; build and launch on a device or emulator.</li>
        <li><Code>npx cap doctor</Code> &mdash; check your setup and flag version mismatches.</li>
      </ul>

      <Callout>
        <p>
          The number-one confusion: <Code>copy</Code> vs <Code>sync</Code>. Use <Code>copy</Code> after a
          web change; use <Code>sync</Code> after a plugin change (it also updates native deps). When in
          doubt, <Code>sync</Code> &mdash; it does both.
        </p>
      </Callout>

      <h2>The typical loop</h2>
      <Pre>{`npm run build        # build your web app
npx cap sync         # push it + deps into native
npx cap open ios     # open Xcode to run/submit`}</Pre>
      <p>
        The thing to internalize: Capacitor doesn&apos;t watch your web build. If you changed your web app
        and don&apos;t see it on device, you almost certainly skipped <Code>build</Code> then{' '}
        <Code>copy</Code>/<Code>sync</Code>.
      </p>

      <h2>Where the OtaKit CLI comes in</h2>
      <p>
        The Capacitor CLI manages the <em>native</em> build. The OtaKit CLI ships <em>web-layer updates</em>
        to already-installed apps. After a binary is live, you stop running <Code>cap open</Code> for every
        change and start running:
      </p>
      <Pre>{`otakit upload --release production`}</Pre>
      <p>
        See the <A href="/docs/cli">OtaKit CLI reference</A> for every command and flag, and{' '}
        <A href="/blog/npm-scripts-for-capacitor-ota">npm scripts</A> to wrap both CLIs into simple
        one-liners.
      </p>

      <Callout>
        <p>
          Add <Code>npx cap sync</Code> to a post-install hook so teammates&apos; native projects never
          drift from the plugins in <Code>package.json</Code> &mdash; a frequent source of
          &ldquo;works on my machine&rdquo; build failures.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See the <A href="/docs/setup">setup docs</A> for the full first-run flow, and{' '}
        <A href="/blog/fix-capacitor-version-mismatch">version mismatch</A> for when{' '}
        <Code>cap doctor</Code> complains.
      </p>
    </BlogArticle>
  );
}
