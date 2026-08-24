import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('astro-to-ios-android-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function AstroToNativePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Astro builds fast, content-rich sites, and with static output it wraps cleanly as a native app.
        If you&apos;ve built a site or app in Astro and want it on iOS and Android, Capacitor takes the
        static build to the stores &mdash; and <A href="/">OtaKit</A> pushes content and UI changes over
        the air afterward. This guide covers the full path.
      </p>

      <Callout>
        <p>
          The one requirement: build Astro to <strong>static output</strong>. Capacitor ships a folder of
          static assets to the device, so a server-rendered Astro deployment needs to be configured for a
          static build first.
        </p>
      </Callout>

      <h2>1. Configure a static build</h2>
      <p>
        Use Astro&apos;s static output (the default for content sites) so <Code>astro build</Code> emits a
        self-contained <Code>dist/</Code>. If you use SSR features, move the dynamic parts to client-side
        fetches against your API so the shipped bundle is fully static.
      </p>

      <h2>2. Add Capacitor</h2>
      <Pre>{`npm install @capacitor/core @capacitor/cli
npx cap init
npm install @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android`}</Pre>
      <p>
        Point <Code>webDir</Code> at <Code>dist</Code>, then <Code>astro build &amp;&amp; npx cap sync</Code>.
      </p>

      <h2>3. Handle routing and links</h2>
      <p>
        Astro&apos;s multi-page routing works on device, but make sure internal links resolve relative to
        the bundle and external calls use absolute URLs. Test navigation on a real device &mdash; static
        multi-page apps sometimes surprise you with how they resolve paths inside the WebView.
      </p>

      <h2>4. Add the native polish</h2>
      <ul>
        <li>Safe areas &mdash; see <A href="/blog/capacitor-edge-to-edge-display">edge-to-edge display</A>.</li>
        <li>Splash screen &mdash; see <A href="/blog/capacitor-splash-screen-guide">splash screens</A>.</li>
      </ul>

      <h2>5. Ship content updates over the air</h2>
      <p>
        This is where Astro + OTA shines: content-heavy apps change their content constantly. Rebuild and
        push over the air instead of resubmitting:
      </p>
      <Pre>{`otakit upload --release production`}</Pre>

      <Callout>
        <p>
          For a content app, OTA is effectively a CMS-to-device pipeline: publish, rebuild, push, and the
          new content is live without a store cycle.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/vite-app-to-ios-android-with-capacitor">the framework-agnostic Vite guide</A>
        {' '}for the general pattern and <A href="/docs/setup">Setup</A> to wire up OtaKit.
      </p>
    </BlogArticle>
  );
}
