import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('remix-to-ios-android-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function RemixToNativePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Remix is a server-first framework, which makes &ldquo;wrap it as a native app&rdquo; a slightly
        more interesting question than for a plain SPA &mdash; a Capacitor app ships static assets to the
        device and has no Remix server running there. The answer is Remix&apos;s SPA mode. This guide
        covers taking a Remix app to iOS and Android with Capacitor, and shipping updates over the air with{' '}
        <A href="/">OtaKit</A>.
      </p>

      <Callout>
        <p>
          The core adjustment: the device runs your client bundle only, and talks to your Remix backend
          over the network like any API. Use SPA mode so the build produces a client app that boots without
          a server render.
        </p>
      </Callout>

      <h2>1. Enable SPA mode</h2>
      <p>
        Configure Remix&apos;s SPA mode so <Code>build</Code> emits a static client bundle. Your loaders
        and actions move to being called as API endpoints against your deployed backend, rather than
        server-rendering each request on the device.
      </p>

      <h2>2. Add Capacitor</h2>
      <Pre>{`npm install @capacitor/core @capacitor/cli
npx cap init
npm install @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android`}</Pre>
      <p>
        Point <Code>webDir</Code> at the SPA build output, then <Code>npm run build &amp;&amp; npx cap sync</Code>.
      </p>

      <h2>3. Point data calls at your backend</h2>
      <p>
        On device there&apos;s no same-origin server, so every data call needs an absolute URL to your
        deployed Remix/API host, with CORS configured. This is the most common thing to get wrong &mdash;
        relative fetches that worked on the web silently fail on device.
      </p>

      <h2>4. Native polish + live updates</h2>
      <ul>
        <li>Safe areas &mdash; see <A href="/blog/capacitor-edge-to-edge-display">edge-to-edge display</A>.</li>
        <li>Splash screen &mdash; see <A href="/blog/capacitor-splash-screen-guide">splash screens</A>.</li>
      </ul>
      <p>
        Then ship JS/CSS changes over the air:
      </p>
      <Pre>{`otakit upload --release production`}</Pre>

      <Callout>
        <p>
          Since the device runs the client bundle, most of your iteration is client-side &mdash; exactly
          the code OTA updates ship. Backend changes deploy as usual on your server; client changes go over
          the air.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/blog/react-to-ios-android-with-capacitor">the React guide</A> for the SPA
        fundamentals and <A href="/docs/setup">Setup</A> to add OtaKit.
      </p>
    </BlogArticle>
  );
}
