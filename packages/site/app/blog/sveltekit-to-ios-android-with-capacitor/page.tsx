import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('sveltekit-to-ios-android-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function SvelteKitToMobilePage() {
  return (
    <BlogArticle post={post}>
      <p>
        SvelteKit apps are fast, small, and &mdash; with the static adapter &mdash; a perfect
        payload for Capacitor. You keep your routes, components, and stores, and ship the same
        codebase to the web, iOS, and Android. No rewrite, no separate mobile stack.
      </p>
      <p>
        This guide takes a SvelteKit app to installable native builds, then adds{' '}
        <A href="/">OtaKit</A> so you can push updates over the air rather than through a store
        review each time.
      </p>

      <Callout>
        <p>
          Mental model: the static adapter turns SvelteKit into a shippable web bundle; Capacitor
          wraps it natively; OtaKit keeps it updated after launch.
        </p>
      </Callout>

      <h2>1. Switch to the static adapter</h2>
      <p>Install and configure adapter-static so SvelteKit prerenders a fully static site:</p>
      <Pre>{`npm install -D @sveltejs/adapter-static`}</Pre>
      <Pre>{`// svelte.config.js
import adapter from "@sveltejs/adapter-static";

export default {
  kit: {
    adapter: adapter({ fallback: "index.html" }),
    paths: { relative: true }, // relative paths for file:// context
  },
};`}</Pre>
      <p>
        Enable prerendering in your root layout. The <Code>index.html</Code> fallback lets
        client-side routing handle any path inside the web view:
      </p>
      <Pre>{`// src/routes/+layout.ts
export const prerender = true;
export const ssr = false;`}</Pre>
      <p>
        Server endpoints (<Code>+server.ts</Code>) don&apos;t run on-device &mdash; call your API
        over HTTPS instead. Building now emits a static site to <Code>build/</Code>.
      </p>

      <h2>2. Add Capacitor</h2>
      <Pre>{`npm install @capacitor/core
npm install -D @capacitor/cli

npx cap init "My App" com.example.myapp --web-dir build

npm install @capacitor/ios @capacitor/android`}</Pre>
      <Pre>{`// capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "build",
};

export default config;`}</Pre>

      <h2>3. Build the native apps</h2>
      <Pre>{`npm run build
npx cap add ios
npx cap add android
npx cap sync`}</Pre>
      <Pre>{`// package.json
"scripts": {
  "mobile": "vite build && npx cap sync"
}`}</Pre>

      <h2>4. Reach device features</h2>
      <Pre>{`npm install @capacitor/haptics
npx cap sync`}</Pre>
      <Pre>{`import { Haptics, ImpactStyle } from "@capacitor/haptics";

async function tap() {
  await Haptics.impact({ style: ImpactStyle.Light });
}`}</Pre>

      <h2>5. Add live updates with OtaKit</h2>
      <Pre>{`npm install @otakit/capacitor-updater
npx cap sync`}</Pre>
      <Pre>{`// capacitor.config.ts
const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "build",
  plugins: {
    OtaKit: { appId: "YOUR_OTAKIT_APP_ID" },
  },
};`}</Pre>
      <p>Confirm a successful boot from your root layout so OtaKit can auto-roll-back:</p>
      <Pre>{`// src/routes/+layout.svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { Capacitor } from "@capacitor/core";
  import { OtaKit } from "@otakit/capacitor-updater";

  onMount(() => {
    if (Capacitor.isNativePlatform()) OtaKit.notifyAppReady();
  });
</script>`}</Pre>
      <Pre>{`npm install -g @otakit/cli
otakit login

npm run build
otakit upload --release`}</Pre>
      <p>
        After your first store release with the plugin in place, every{' '}
        <Code>otakit upload --release</Code> lands on installed devices on the next launch. Bundles
        are signed, hash-verified, and CDN-delivered &mdash; with no monthly-active-user or
        bandwidth metering. Native changes still go through the store; your SvelteKit build ships
        over the air.
      </p>

      <Callout>
        <p>
          Want to roll out gradually? See{' '}
          <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A> for the
          channel-based approach.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        The <A href="/docs/setup">setup guide</A> has the complete flow. Then read{' '}
        <A href="/blog/common-capacitor-ota-mistakes">common OTA mistakes</A> and{' '}
        <A href="/blog/capacitor-ota-update-security">OTA security</A>.
      </p>
    </BlogArticle>
  );
}
