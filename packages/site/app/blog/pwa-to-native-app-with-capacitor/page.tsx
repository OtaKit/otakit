import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('pwa-to-native-app-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function PwaToNativePage() {
  return (
    <BlogArticle post={post}>
      <p>
        A PWA already runs everywhere &mdash; except where a lot of your users look for apps: the App
        Store and Google Play. Capacitor closes that gap. It wraps your PWA as a real native app you
        can submit to both stores, gives it access to device APIs a browser can&apos;t reach, and
        keeps your single web codebase intact.
      </p>
      <p>
        This guide takes an existing PWA to installable native builds and adds <A href="/">OtaKit</A>{' '}
        so the app updates over the air &mdash; the same &ldquo;always current&rdquo; feel a PWA has
        on the web.
      </p>

      <Callout>
        <p>
          Mental model: your PWA stays exactly what it is on the web. Capacitor adds a native
          wrapper for the stores; OtaKit handles updates inside that wrapper.
        </p>
      </Callout>

      <h2>1. Point Capacitor at your build output</h2>
      <p>
        A PWA is just a web app with a manifest and a service worker, so there&apos;s nothing special
        to change &mdash; identify the folder your build produces (<Code>dist</Code>,{' '}
        <Code>build</Code>, or <Code>out</Code>) and make sure assets use relative paths.
      </p>
      <Pre>{`npm install @capacitor/core
npm install -D @capacitor/cli

npx cap init "My App" com.example.myapp --web-dir dist

npm install @capacitor/ios @capacitor/android`}</Pre>

      <h2>2. Rethink the service worker</h2>
      <p>
        This is the one PWA-specific gotcha. On the web, your service worker caches assets and
        handles offline. Inside a Capacitor app, the web layer already loads from local files, and a
        service worker&apos;s caching can fight with native updates &mdash; you can end up serving a
        stale cache after an OTA update lands.
      </p>
      <p>
        The clean approach: let Capacitor serve the bundle from disk, and let OtaKit handle updates
        instead of the service worker&apos;s cache. Either disable the service worker on native, or
        scope its caching so it doesn&apos;t shadow the bundle. Detect the platform to branch:
      </p>
      <Pre>{`import { Capacitor } from "@capacitor/core";

if (!Capacitor.isNativePlatform() && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js"); // web only
}`}</Pre>

      <h2>3. Build the native apps</h2>
      <Pre>{`npm run build
npx cap add ios
npx cap add android
npx cap sync`}</Pre>
      <p>
        Run with <Code>npx cap open ios</Code> / <Code>npx cap open android</Code>. Your PWA now runs
        as a native app, with the same UI it always had.
      </p>

      <h2>4. Add live updates with OtaKit</h2>
      <p>
        This is what restores the PWA&apos;s best trait &mdash; being always up to date &mdash; in
        the native wrapper:
      </p>
      <Pre>{`npm install @otakit/capacitor-updater
npx cap sync`}</Pre>
      <Pre>{`// capacitor.config.ts
const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "dist",
  plugins: {
    OtaKit: { appId: "YOUR_OTAKIT_APP_ID" },
  },
};`}</Pre>
      <Pre>{`import { Capacitor } from "@capacitor/core";
import { OtaKit } from "@otakit/capacitor-updater";

if (Capacitor.isNativePlatform()) OtaKit.notifyAppReady();`}</Pre>
      <Pre>{`npm install -g @otakit/cli
otakit login

npm run build
otakit upload --release`}</Pre>
      <p>
        Now a change you deploy to your PWA on the web can ship to the installed native app the same
        day with <Code>otakit upload --release</Code> &mdash; no store review for web-layer changes.
        Native changes (new plugins, permissions) still go through the store.
      </p>

      <Callout>
        <p>
          Best of both worlds: the reach and updateability of a PWA, plus a store presence and native
          device access. See <A href="/blog/app-store-compliant-ota-updates">why OTA is compliant</A>
          .
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        The <A href="/docs/setup">setup guide</A> covers the full flow. Then read{' '}
        <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A> and{' '}
        <A href="/blog/background-vs-foreground-app-updates">background vs foreground update UX</A>.
      </p>
    </BlogArticle>
  );
}
