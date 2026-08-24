import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('bolt-app-to-ios-android-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function BoltToNativePage() {
  return (
    <BlogArticle post={post}>
      <p>
        You built something real in Bolt.new &mdash; a working web app, fast. Now you want it on the App
        Store and Google Play. You don&apos;t need to rewrite it in Swift or React Native. Bolt produces a
        standard web app, and Capacitor wraps a standard web app as native iOS and Android. This guide
        takes your Bolt project to the stores and keeps it improving with <A href="/">OtaKit</A> live
        updates.
      </p>

      <Callout>
        <p>
          Because Bolt output is a normal web app (typically Vite + React), this is the same path any web
          app takes to native &mdash; nothing Bolt-specific blocks it. See{' '}
          <A href="/blog/react-to-ios-android-with-capacitor">React to iOS &amp; Android</A> for the
          underlying flow.
        </p>
      </Callout>

      <h2>1. Export your Bolt project</h2>
      <p>
        Get the code out of Bolt to a local repo &mdash; download or push to GitHub &mdash; and confirm it
        builds and runs locally with <Code>npm install</Code> and <Code>npm run build</Code>.
      </p>

      <h2>2. Add Capacitor</h2>
      <Pre>{`npm install @capacitor/core @capacitor/cli
npx cap init
npm install @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android`}</Pre>
      <p>
        Point <Code>webDir</Code> at your build output (usually <Code>dist</Code>), then{' '}
        <Code>npm run build &amp;&amp; npx cap sync</Code>.
      </p>

      <h2>3. Handle the mobile basics</h2>
      <ul>
        <li>Make sure API calls use absolute URLs &mdash; there&apos;s no dev server on device.</li>
        <li>Add safe-area handling &mdash; see <A href="/blog/capacitor-edge-to-edge-display">edge-to-edge display</A>.</li>
        <li>Add a splash screen &mdash; see <A href="/blog/capacitor-splash-screen-guide">splash screens</A>.</li>
      </ul>

      <h2>4. Add live updates</h2>
      <p>
        AI-built apps iterate constantly. Wire up OtaKit so every tweak ships over the air instead of
        through a store review:
      </p>
      <Pre>{`otakit upload --release production`}</Pre>
      <p>
        This is the difference between &ldquo;ship once&rdquo; and &ldquo;keep shipping.&rdquo; See{' '}
        <A href="/blog/capacitor-ai-mobile-apps">why Capacitor is the best way to ship AI apps</A>.
      </p>

      <Callout>
        <p>
          Ship one store binary, then iterate over the air. For a fast-moving Bolt project, that turns the
          App Store from a bottleneck into a one-time step.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/setup">Setup</A> and, for other AI builders,{' '}
        <A href="/blog/lovable-app-to-ios-android-with-capacitor">Lovable</A> and{' '}
        <A href="/blog/base44-app-to-ios-android-with-capacitor">Base44</A>.
      </p>
    </BlogArticle>
  );
}
