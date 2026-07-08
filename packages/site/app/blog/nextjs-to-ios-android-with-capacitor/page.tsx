import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('nextjs-to-ios-android-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function NextjsToMobilePage() {
  return (
    <BlogArticle post={post}>
      <p>
        You already have a Next.js app. Capacitor lets you ship it to the App Store and Google Play
        as a real native app — the same React code, the same components, wrapped in a native shell
        with access to the camera, filesystem, push notifications, and every other device API. You
        don&apos;t rewrite anything in Swift or Kotlin, and you don&apos;t learn React Native.
      </p>
      <p>
        This guide takes an existing Next.js project to installable iOS and Android builds, then
        wires up <A href="/">OtaKit</A> so you can push JavaScript, CSS, and content changes
        straight to installed devices over the air — without waiting on a store review every time.
      </p>

      <Callout>
        <p>
          Mental model: Capacitor turns your web build into a native app. OtaKit keeps that web
          layer up to date after it ships, in minutes instead of days.
        </p>
      </Callout>

      <h2>Prerequisites</h2>
      <ul>
        <li>An existing Next.js 14/15 app (App Router or Pages Router).</li>
        <li>Node 20+, plus Xcode (for iOS) and Android Studio (for Android).</li>
        <li>
          A Next.js app that can render without a Node server at runtime — see the next section.
        </li>
      </ul>

      <h2>1. Configure Next.js for static export</h2>
      <p>
        Capacitor bundles static web assets into the native app, so it needs an exported build
        rather than a running Node server. Next.js produces exactly that with{' '}
        <Code>output: &apos;export&apos;</Code>. Add it to your config:
      </p>
      <Pre>{`// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true }, // the Image Optimization API needs a server
};

export default nextConfig;`}</Pre>
      <p>
        Running <Code>next build</Code> now emits a fully static site into <Code>out/</Code>. The
        tradeoff is that server-only features — Route Handlers, Server Actions, ISR, middleware —
        don&apos;t run inside the native shell. In practice you move those to an API you call over
        HTTPS, which is exactly how a mobile app should talk to your backend anyway.
      </p>

      <h2>2. Add Capacitor to the project</h2>
      <Pre>{`npm install @capacitor/core
npm install -D @capacitor/cli

# initialize — appId is your reverse-domain bundle id
npx cap init "My App" com.example.myapp --web-dir out

npm install @capacitor/ios @capacitor/android`}</Pre>
      <p>
        The <Code>--web-dir out</Code> flag points Capacitor at the folder Next.js exports to. Your{' '}
        <Code>capacitor.config.ts</Code> should read:
      </p>
      <Pre>{`// capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "out",
};

export default config;`}</Pre>

      <h2>3. Generate the native projects</h2>
      <Pre>{`npm run build          # produces out/
npx cap add ios
npx cap add android
npx cap sync           # copies the web build into both native projects`}</Pre>
      <p>
        You now have real <Code>ios/</Code> and <Code>android/</Code> folders. Open them with{' '}
        <Code>npx cap open ios</Code> or <Code>npx cap open android</Code> and run on a simulator or
        device straight from Xcode / Android Studio. A useful habit is one script that does the
        whole loop:
      </p>
      <Pre>{`// package.json
"scripts": {
  "mobile": "next build && npx cap sync"
}`}</Pre>

      <h2>4. Handle iOS safe areas</h2>
      <p>
        The one layout gotcha worth fixing early: content sliding under the notch and home
        indicator. Opt into the safe-area insets from a single root wrapper rather than sprinkling
        them everywhere:
      </p>
      <Pre>{`:root {
  --safe-top: env(safe-area-inset-top);
  --safe-bottom: env(safe-area-inset-bottom);
}
body {
  padding-top: var(--safe-top);
  padding-bottom: var(--safe-bottom);
}`}</Pre>
      <p>
        Add <Code>viewport-fit=cover</Code> to your viewport meta so the insets report real values,
        and you&apos;re done.
      </p>

      <h2>5. Add live updates with OtaKit</h2>
      <p>
        Here&apos;s the payoff. Because everything your users see is that exported web layer, you can
        update it over the air. Install the plugin and point it at your OtaKit app:
      </p>
      <Pre>{`npm install @otakit/capacitor-updater
npx cap sync`}</Pre>
      <Pre>{`// capacitor.config.ts
const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "out",
  plugins: {
    OtaKit: { appId: "YOUR_OTAKIT_APP_ID" },
  },
};`}</Pre>
      <p>
        Confirm each new bundle actually booted so OtaKit can roll back a broken release instead of
        stranding users. Call <Code>notifyAppReady()</Code> once the app has mounted — in Next.js,
        from a client component:
      </p>
      <Pre>{`"use client";
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { OtaKit } from "@otakit/capacitor-updater";

export function AppReadyProvider() {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) OtaKit.notifyAppReady();
  }, []);
  return null;
}`}</Pre>
      <p>Then ship an update from your machine or CI:</p>
      <Pre>{`npm install -g @otakit/cli
otakit login

npm run build
otakit upload --release`}</Pre>
      <p>
        Publish your app to the stores once with the plugin configured. After that, every{' '}
        <Code>otakit upload --release</Code> reaches installed devices on their next launch — new
        UI, copy fixes, and bug fixes land the same day you write them. Native changes (new plugins,
        permissions, a Capacitor upgrade) still go through the store; everything in your{' '}
        <Code>out/</Code> folder does not. That line is exactly what keeps OTA{' '}
        <A href="/blog/app-store-compliant-ota-updates">compliant with Apple and Google</A>.
      </p>

      <Callout>
        <p>
          OtaKit doesn&apos;t meter monthly active users or bandwidth — bundles ship straight from a
          CDN edge, and most apps pay $0–25/mo. See how it compares in the{' '}
          <A href="/blog/best-live-update-frameworks-for-capacitor-apps">2026 tool comparison</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        The <A href="/docs/guide">Next.js guide</A> covers the full setup, and{' '}
        <A href="/blog/automate-capacitor-ota-releases-github-actions">
          automating releases with GitHub Actions
        </A>{' '}
        turns every merge to main into a live update. If you&apos;re weighing Capacitor against a
        full rewrite, the <A href="/blog/react-native-vs-capacitor">React Native vs Capacitor</A>{' '}
        comparison is a good next read.
      </p>
    </BlogArticle>
  );
}
