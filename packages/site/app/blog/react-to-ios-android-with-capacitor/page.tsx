import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('react-to-ios-android-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function ReactToMobilePage() {
  return (
    <BlogArticle post={post}>
      <p>
        The fastest way to get a React app onto the App Store and Google Play isn&apos;t React
        Native — it&apos;s Capacitor. Capacitor wraps your existing React build in a native shell,
        so the components, hooks, and libraries you already have run as-is. No new framework, no
        parallel codebase, no rewriting your UI in native primitives.
      </p>
      <p>
        This guide takes a plain React app (built with Vite) to installable iOS and Android
        binaries, then adds <A href="/">OtaKit</A> so you can push updates to the web layer over the
        air instead of shipping a new build for every fix.
      </p>

      <Callout>
        <p>
          Mental model: React Native rewrites your UI into native views. Capacitor keeps your web UI
          and gives it a native container. For a full breakdown of the tradeoff, see{' '}
          <A href="/blog/react-native-vs-capacitor">React Native vs Capacitor</A>.
        </p>
      </Callout>

      <h2>Prerequisites</h2>
      <ul>
        <li>A React app built with Vite (or any bundler that outputs static files).</li>
        <li>Node 20+, Xcode for iOS builds, Android Studio for Android builds.</li>
      </ul>

      <h2>1. Confirm your build output</h2>
      <p>
        Capacitor ships static assets, so you just need a folder of built files. A Vite React app
        already produces one at <Code>dist/</Code> when you run <Code>npm run build</Code>. If
        you&apos;re on Create React App, that folder is <Code>build/</Code> instead — note whichever
        it is; Capacitor needs to know.
      </p>
      <p>
        One thing to check: use relative asset paths. In <Code>vite.config.ts</Code>, set{' '}
        <Code>base: &apos;./&apos;</Code> so assets resolve correctly from the native{' '}
        <Code>file://</Code> context.
      </p>

      <h2>2. Add Capacitor</h2>
      <Pre>{`npm install @capacitor/core
npm install -D @capacitor/cli

npx cap init "My App" com.example.myapp --web-dir dist

npm install @capacitor/ios @capacitor/android`}</Pre>
      <p>Your config should point at the Vite output directory:</p>
      <Pre>{`// capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "dist",
};

export default config;`}</Pre>

      <h2>3. Create and run the native apps</h2>
      <Pre>{`npm run build
npx cap add ios
npx cap add android
npx cap sync`}</Pre>
      <p>
        Open either platform with <Code>npx cap open ios</Code> / <Code>npx cap open android</Code>{' '}
        and run it. Wrap the repetitive part in a script so you never forget the sync step:
      </p>
      <Pre>{`// package.json
"scripts": {
  "mobile": "vite build && npx cap sync"
}`}</Pre>

      <h2>4. Reach device features</h2>
      <p>
        Anything native is a Capacitor plugin you import like any React dependency. For example, the
        camera:
      </p>
      <Pre>{`npm install @capacitor/camera
npx cap sync`}</Pre>
      <Pre>{`import { Camera, CameraResultType } from "@capacitor/camera";

async function takePhoto() {
  const photo = await Camera.getPhoto({
    quality: 90,
    resultType: CameraResultType.Uri,
  });
  return photo.webPath;
}`}</Pre>
      <p>
        On the web the same call falls back to a file input, so your components stay portable across
        browser and device.
      </p>

      <h2>5. Add over-the-air updates with OtaKit</h2>
      <p>
        Because your UI is the web layer, you can update it without a store round-trip. Install the
        plugin and configure your OtaKit app id:
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
      <p>
        Call <Code>notifyAppReady()</Code> after your app mounts so OtaKit knows the new bundle
        booted successfully — if it never hears back, it rolls the device back automatically:
      </p>
      <Pre>{`import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { OtaKit } from "@otakit/capacitor-updater";

function App() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) OtaKit.notifyAppReady();
  }, []);
  // ...
}`}</Pre>
      <p>Install the CLI, then ship:</p>
      <Pre>{`npm install -g @otakit/cli
otakit login

npm run build
otakit upload --release`}</Pre>
      <p>
        After your first store release with the plugin in place, every{' '}
        <Code>otakit upload --release</Code> lands on installed devices on their next launch.
        Bundles are signed and verified by SHA-256, and download directly from a CDN edge — with no
        monthly-active-user or bandwidth metering. Native changes still require a store submission;
        your React bundle does not.
      </p>

      <Callout>
        <p>
          Want to roll out to a slice of users first? See{' '}
          <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A> for the
          channel-based approach.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        The <A href="/docs/react">React guide</A> has the complete setup. From there,{' '}
        <A href="/blog/automate-capacitor-ota-releases-github-actions">automate releases in CI</A>{' '}
        and read up on <A href="/blog/capacitor-ota-update-security">securing your update pipeline</A>
        .
      </p>
    </BlogArticle>
  );
}
