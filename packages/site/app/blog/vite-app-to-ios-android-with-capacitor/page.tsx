import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('vite-app-to-ios-android-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function ViteToMobilePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Capacitor doesn&apos;t care which framework you use &mdash; it ships whatever static files
        your build produces. If your app is built with Vite, this guide applies whether you&apos;re
        on React, Vue, Solid, Preact, Lit, or plain vanilla JavaScript. Same steps, same result:
        native iOS and Android apps from your existing web build.
      </p>
      <p>
        We&apos;ll go from a Vite project to installable native apps, then add <A href="/">OtaKit</A>{' '}
        for over-the-air updates.
      </p>

      <Callout>
        <p>
          Mental model: Capacitor targets your <Code>dist/</Code> folder, not your framework. If it
          builds to static files, it ships.
        </p>
      </Callout>

      <h2>1. Set a relative base</h2>
      <p>
        Native web views load from a <Code>file://</Code> origin, so absolute asset paths break. Tell
        Vite to emit relative paths:
      </p>
      <Pre>{`// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
});`}</Pre>
      <p>
        Running <Code>npm run build</Code> produces a static site in <Code>dist/</Code> &mdash;
        that&apos;s your payload.
      </p>

      <h2>2. Add Capacitor</h2>
      <Pre>{`npm install @capacitor/core
npm install -D @capacitor/cli

npx cap init "My App" com.example.myapp --web-dir dist

npm install @capacitor/ios @capacitor/android`}</Pre>
      <Pre>{`// capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "dist",
};

export default config;`}</Pre>

      <h2>3. Create and run the native projects</h2>
      <Pre>{`npm run build
npx cap add ios
npx cap add android
npx cap sync`}</Pre>
      <Pre>{`// package.json
"scripts": {
  "mobile": "vite build && npx cap sync"
}`}</Pre>
      <p>
        Then <Code>npx cap open ios</Code> / <Code>npx cap open android</Code> to run on a simulator
        or device.
      </p>

      <h2>4. Reach device features</h2>
      <p>Any native capability is a Capacitor plugin you import like a normal dependency:</p>
      <Pre>{`npm install @capacitor/preferences
npx cap sync`}</Pre>
      <Pre>{`import { Preferences } from "@capacitor/preferences";

await Preferences.set({ key: "onboarded", value: "true" });
const { value } = await Preferences.get({ key: "onboarded" });`}</Pre>

      <h2>5. Add live updates with OtaKit</h2>
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
        Call <Code>notifyAppReady()</Code> after your app initializes &mdash; the exact spot depends
        on your framework, but the idea is the same everywhere: signal a clean boot so OtaKit can
        auto-roll-back a broken release.
      </p>
      <Pre>{`import { Capacitor } from "@capacitor/core";
import { OtaKit } from "@otakit/capacitor-updater";

if (Capacitor.isNativePlatform()) {
  OtaKit.notifyAppReady();
}`}</Pre>
      <Pre>{`npm install -g @otakit/cli
otakit login

npm run build
otakit upload --release`}</Pre>
      <p>
        Once your app is on the stores with the plugin configured, each{' '}
        <Code>otakit upload --release</Code> reaches installed devices on the next launch. Native
        changes still require a store submission; your Vite bundle ships over the air &mdash; signed,
        hash-verified, CDN-delivered, and with no per-user or bandwidth billing.
      </p>

      <Callout>
        <p>
          On React or Vue specifically? The{' '}
          <A href="/blog/react-to-ios-android-with-capacitor">React</A> and{' '}
          <A href="/blog/vue-to-ios-android-with-capacitor">Vue</A> guides show the framework-exact
          placement of <Code>notifyAppReady()</Code>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Read <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A>, then{' '}
        <A href="/blog/reduce-capacitor-app-bundle-size">reduce your bundle size</A> for faster
        startups and smaller updates.
      </p>
    </BlogArticle>
  );
}
