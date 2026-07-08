import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('vue-to-ios-android-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function VueToMobilePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Your Vue app can become a real iOS and Android app without a rewrite. Capacitor wraps the
        static build your Vue project already produces in a native shell, exposes device APIs
        through plugins, and submits to both stores like any native app. Your components,
        composables, Pinia stores, and router all run unchanged.
      </p>
      <p>
        This guide takes a Vue 3 + Vite app to installable native builds, then adds{' '}
        <A href="/">OtaKit</A> so you can ship web-layer updates over the air in minutes instead of
        queuing behind a store review.
      </p>

      <Callout>
        <p>
          Mental model: Capacitor gives your existing Vue app a native container. OtaKit keeps that
          web layer current after it ships.
        </p>
      </Callout>

      <h2>Prerequisites</h2>
      <ul>
        <li>A Vue 3 app built with Vite.</li>
        <li>Node 20+, Xcode for iOS, Android Studio for Android.</li>
      </ul>

      <h2>1. Prepare the Vite build</h2>
      <p>
        Vite outputs a static site to <Code>dist/</Code> on <Code>npm run build</Code> — that&apos;s
        what Capacitor ships. Set a relative base so assets resolve from the native{' '}
        <Code>file://</Code> origin:
      </p>
      <Pre>{`// vite.config.ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: "./",
  plugins: [vue()],
});`}</Pre>
      <p>
        If you use Vue Router, prefer hash history (<Code>createWebHashHistory</Code>) for the
        native build — it avoids deep-link 404s inside the web view without extra native routing
        config.
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

      <h2>3. Build the native projects</h2>
      <Pre>{`npm run build
npx cap add ios
npx cap add android
npx cap sync`}</Pre>
      <p>
        Run with <Code>npx cap open ios</Code> or <Code>npx cap open android</Code>. Add a script to
        keep the build-and-sync loop one command:
      </p>
      <Pre>{`// package.json
"scripts": {
  "mobile": "vite build && npx cap sync"
}`}</Pre>

      <h2>4. Use native device features</h2>
      <p>Device APIs are plugins you import inside a composable or component:</p>
      <Pre>{`npm install @capacitor/geolocation
npx cap sync`}</Pre>
      <Pre>{`import { Geolocation } from "@capacitor/geolocation";

async function currentPosition() {
  const { coords } = await Geolocation.getCurrentPosition();
  return { lat: coords.latitude, lng: coords.longitude };
}`}</Pre>

      <h2>5. Add live updates with OtaKit</h2>
      <p>Install the plugin and set your OtaKit app id:</p>
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
        Signal a successful boot from your root component so OtaKit can auto-roll-back a bad release:
      </p>
      <Pre>{`import { onMounted } from "vue";
import { Capacitor } from "@capacitor/core";
import { OtaKit } from "@otakit/capacitor-updater";

onMounted(() => {
  if (Capacitor.isNativePlatform()) OtaKit.notifyAppReady();
});`}</Pre>
      <p>Then release:</p>
      <Pre>{`npm install -g @otakit/cli
otakit login

npm run build
otakit upload --release`}</Pre>
      <p>
        Once your app is on the stores with the plugin configured, each{' '}
        <Code>otakit upload --release</Code> reaches installed devices on the next launch. Bundles
        are ES256-signed, hash-verified, CDN-delivered, and optionally end-to-end encrypted — with
        no per-user or bandwidth billing. Native changes still go through the store; your Vue bundle
        ships over the air.
      </p>

      <Callout>
        <p>
          New to how any of this works under the hood? Start with{' '}
          <A href="/blog/how-ota-works-for-capacitor-apps">how OTA updates work in Capacitor apps</A>
          .
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        The <A href="/docs/setup">setup guide</A> gets you running end to end. Then look at{' '}
        <A href="/blog/common-capacitor-ota-mistakes">common OTA mistakes to avoid</A> and{' '}
        <A href="/blog/automate-capacitor-ota-releases-github-actions">
          automating releases with GitHub Actions
        </A>
        .
      </p>
    </BlogArticle>
  );
}
