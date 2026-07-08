import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('nuxt-to-ios-android-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function NuxtToMobilePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Nuxt is a full-stack framework, but for a mobile app you only need the front end &mdash; a
        static build that runs client-side inside a native shell. Capacitor takes that build and
        turns your Nuxt app into real iOS and Android apps, no rewrite required. Your pages,
        components, composables, and Pinia stores all run as-is.
      </p>
      <p>
        This guide takes a Nuxt 3/4 app to installable native builds, then wires up{' '}
        <A href="/">OtaKit</A> so you can push web-layer updates over the air in minutes.
      </p>

      <Callout>
        <p>
          Mental model: server-rendered Nuxt features stay on your server; the app that ships to
          devices is the static client build. OtaKit keeps that build up to date over the air.
        </p>
      </Callout>

      <h2>1. Configure Nuxt for a static client app</h2>
      <p>
        Capacitor needs a folder of static files with no Node server at runtime. Render the app as a
        client-side SPA and generate it:
      </p>
      <Pre>{`// nuxt.config.ts
export default defineNuxtConfig({
  ssr: false, // ship a client-rendered SPA to the device
  app: { baseURL: "./" }, // relative asset paths for file:// context
});`}</Pre>
      <Pre>{`npx nuxi generate   # outputs .output/public`}</Pre>
      <p>
        Server routes, Nitro API handlers, and server-only middleware won&apos;t run inside the
        shell &mdash; move those to an API your app calls over HTTPS, which is how a mobile client
        should talk to a backend anyway.
      </p>

      <h2>2. Add Capacitor</h2>
      <Pre>{`npm install @capacitor/core
npm install -D @capacitor/cli

npx cap init "My App" com.example.myapp --web-dir .output/public

npm install @capacitor/ios @capacitor/android`}</Pre>
      <Pre>{`// capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: ".output/public",
};

export default config;`}</Pre>

      <h2>3. Build and run</h2>
      <Pre>{`npx nuxi generate
npx cap add ios
npx cap add android
npx cap sync`}</Pre>
      <Pre>{`// package.json
"scripts": {
  "mobile": "nuxi generate && npx cap sync"
}`}</Pre>
      <p>
        Then <Code>npx cap open ios</Code> or <Code>npx cap open android</Code> to run on a
        simulator or device.
      </p>

      <h2>4. Use native device features</h2>
      <Pre>{`npm install @capacitor/share
npx cap sync`}</Pre>
      <Pre>{`import { Share } from "@capacitor/share";

async function shareLink() {
  await Share.share({ title: "Check this out", url: "https://example.com" });
}`}</Pre>

      <h2>5. Add live updates with OtaKit</h2>
      <Pre>{`npm install @otakit/capacitor-updater
npx cap sync`}</Pre>
      <Pre>{`// capacitor.config.ts
const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: ".output/public",
  plugins: {
    OtaKit: { appId: "YOUR_OTAKIT_APP_ID" },
  },
};`}</Pre>
      <p>Signal a clean boot from your root app component so a bad release rolls back on its own:</p>
      <Pre>{`// app.vue
<script setup lang="ts">
import { onMounted } from "vue";
import { Capacitor } from "@capacitor/core";
import { OtaKit } from "@otakit/capacitor-updater";

onMounted(() => {
  if (Capacitor.isNativePlatform()) OtaKit.notifyAppReady();
});
</script>`}</Pre>
      <Pre>{`npm install -g @otakit/cli
otakit login

npx nuxi generate
otakit upload --release`}</Pre>
      <p>
        Once your app is on the stores with the plugin configured, each{' '}
        <Code>otakit upload --release</Code> reaches installed devices on the next launch &mdash; new
        UI, content, and fixes the same day. Native changes still require a store submission; your
        Nuxt client build does not.
      </p>

      <Callout>
        <p>
          OtaKit doesn&apos;t meter monthly active users or bandwidth &mdash; see how it compares in
          the <A href="/blog/best-ota-tools-for-capacitor-2026">2026 OTA tools roundup</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Read <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A> for the delivery
        model, and the <A href="/blog/vue-to-ios-android-with-capacitor">Vue guide</A> if you want a
        plain-Vue variant of this flow.
      </p>
    </BlogArticle>
  );
}
