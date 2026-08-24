import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-deep-links-universal-links')!;

export const metadata = blogPostMetadata(post.slug);

export default function DeepLinksPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Deep links let a URL open your app on the right screen &mdash; from an email, a notification, or
        the web. On iOS these are <strong>universal links</strong>; on Android, <strong>app links</strong>.
        Getting them working means a bit of native association plus some routing code. This guide covers
        the full setup in Capacitor, and how <A href="/">OtaKit</A> lets you tune the routing over the air.
      </p>

      <Callout>
        <p>
          The association (proving you own the domain) is native and one-time. The <em>routing</em> &mdash;
          what each URL does inside your app &mdash; is web-layer code you can change over the air whenever
          your URL structure evolves.
        </p>
      </Callout>

      <h2>1. Custom scheme vs universal/app links</h2>
      <ul>
        <li>
          <strong>Custom scheme</strong> (<Code>myapp://</Code>) is the quick option, but any app can
          claim a scheme and it doesn&apos;t work from the web cleanly.
        </li>
        <li>
          <strong>Universal / app links</strong> use your real <Code>https://</Code> domain and are the
          right choice for production &mdash; they require domain association files.
        </li>
      </ul>

      <h2>2. iOS universal links</h2>
      <p>
        Host an <Code>apple-app-site-association</Code> file at your domain root, and add the Associated
        Domains capability with <Code>applinks:yourdomain.com</Code> in Xcode. iOS verifies the file when
        the app installs.
      </p>

      <h2>3. Android app links</h2>
      <p>
        Host an <Code>assetlinks.json</Code> at <Code>/.well-known/</Code>, and add an intent filter with{' '}
        <Code>android:autoVerify=&quot;true&quot;</Code> for your domain in the manifest.
      </p>

      <h2>4. Handle the link in your app</h2>
      <Pre>{`import { App } from '@capacitor/app';

App.addListener('appUrlOpen', (event) => {
  // event.url is the full deep link
  const path = new URL(event.url).pathname;
  router.navigate(path);
});`}</Pre>
      <p>
        This handler is the part you&apos;ll iterate on &mdash; new routes, changed paths, redirects. All
        of it ships over the air:
      </p>
      <Pre>{`otakit upload --release production`}</Pre>

      <Callout>
        <p>
          Test the association files early. A missing or misconfigured{' '}
          <Code>apple-app-site-association</Code> / <Code>assetlinks.json</Code> is the most common reason
          &ldquo;deep links don&apos;t work,&rdquo; and it fails silently &mdash; the link just opens the
          browser instead of the app.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Notification taps often route through the same code &mdash; see{' '}
        <A href="/blog/capacitor-push-notifications-firebase">push notifications</A>. For the setup
        basics, see <A href="/docs/setup">Setup</A>.
      </p>
    </BlogArticle>
  );
}
