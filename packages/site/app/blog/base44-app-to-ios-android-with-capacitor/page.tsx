import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('base44-app-to-ios-android-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function Base44ToNativePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Base44 lets you build a full app fast, and the natural next question is &ldquo;how do I get this in
        the App Store?&rdquo; The answer isn&apos;t a rewrite &mdash; it&apos;s Capacitor, which wraps your
        web app as native iOS and Android. This guide takes a Base44 app to the stores and keeps it
        improving with <A href="/">OtaKit</A> over-the-air updates.
      </p>

      <Callout>
        <p>
          The key requirement: you need access to your app&apos;s <strong>web code and build output</strong>.
          Capacitor wraps a static web build, so exporting the project to a repo you control is step one.
        </p>
      </Callout>

      <h2>1. Get the code into a repo</h2>
      <p>
        Export your Base44 app to a local project or GitHub repo, then confirm it builds and runs with{' '}
        <Code>npm install</Code> and <Code>npm run build</Code>. You want a <Code>dist</Code> (or similar)
        folder of static assets.
      </p>

      <h2>2. Add Capacitor</h2>
      <Pre>{`npm install @capacitor/core @capacitor/cli
npx cap init
npm install @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android`}</Pre>
      <p>
        Set <Code>webDir</Code> to your build output, then <Code>npm run build &amp;&amp; npx cap sync</Code>.
      </p>

      <h2>3. Make it feel native</h2>
      <ul>
        <li>Use absolute URLs for any backend calls &mdash; the app runs from the device, not a dev server.</li>
        <li>Handle safe areas &mdash; see <A href="/blog/capacitor-edge-to-edge-display">edge-to-edge display</A>.</li>
        <li>Add native touches &mdash; splash, status bar, icons.</li>
      </ul>

      <h2>4. Add live updates</h2>
      <p>
        An AI-built app is never really &ldquo;done&rdquo; &mdash; you keep refining. OtaKit ships those
        refinements over the air so you don&apos;t queue behind a store review each time:
      </p>
      <Pre>{`otakit upload --release production`}</Pre>

      <Callout>
        <p>
          One store submission, then iterate freely. For a Base44 project you&apos;re actively evolving,
          that&apos;s the workflow that keeps momentum &mdash; see{' '}
          <A href="/blog/capacitor-ai-mobile-apps">shipping AI apps with Capacitor</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/setup">Setup</A>, and for other AI builders,{' '}
        <A href="/blog/bolt-app-to-ios-android-with-capacitor">Bolt.new</A> and{' '}
        <A href="/blog/lovable-app-to-ios-android-with-capacitor">Lovable</A>.
      </p>
    </BlogArticle>
  );
}
