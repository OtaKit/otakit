import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('angular-to-ios-android-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function AngularToMobilePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Angular is a natural fit for Capacitor. Your existing app &mdash; components, services,
        RxJS, the router &mdash; runs unchanged inside a native shell, and you ship the same
        codebase to the web, iOS, and Android. No NativeScript, no rewrite, no second framework to
        learn.
      </p>
      <p>
        This guide takes a standard Angular app to installable native builds, then adds{' '}
        <A href="/">OtaKit</A> so you can push updates to the web layer over the air instead of
        waiting on a store review for every change.
      </p>

      <Callout>
        <p>
          Mental model: Capacitor gives your Angular app a native container. OtaKit keeps that web
          layer current after it ships.
        </p>
      </Callout>

      <h2>1. Point Angular at a static build</h2>
      <p>
        Capacitor ships a folder of static files. Angular&apos;s application builder outputs one at{' '}
        <Code>dist/&lt;app-name&gt;/browser</Code>. Build it with:
      </p>
      <Pre>{`ng build --configuration production`}</Pre>
      <p>
        One important change for a web view: routing. The default path-location strategy can break
        deep links inside the native <Code>file://</Code> context. Switch to hash location so routes
        resolve reliably:
      </p>
      <Pre>{`import { provideRouter, withHashLocation } from "@angular/router";

bootstrapApplication(AppComponent, {
  providers: [provideRouter(routes, withHashLocation())],
});`}</Pre>

      <h2>2. Add Capacitor</h2>
      <Pre>{`npm install @capacitor/core
npm install -D @capacitor/cli

npx cap init "My App" com.example.myapp

npm install @capacitor/ios @capacitor/android`}</Pre>
      <p>
        Set <Code>webDir</Code> to Angular&apos;s browser output folder (adjust the app name):
      </p>
      <Pre>{`// capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "dist/my-app/browser",
};

export default config;`}</Pre>

      <h2>3. Build the native projects</h2>
      <Pre>{`ng build --configuration production
npx cap add ios
npx cap add android
npx cap sync`}</Pre>
      <p>
        Open a platform with <Code>npx cap open ios</Code> or <Code>npx cap open android</Code> and
        run it. A one-command loop keeps the sync step honest:
      </p>
      <Pre>{`// package.json
"scripts": {
  "mobile": "ng build --configuration production && npx cap sync"
}`}</Pre>

      <h2>4. Reach device features</h2>
      <p>Device APIs are Capacitor plugins you inject like any Angular dependency:</p>
      <Pre>{`npm install @capacitor/geolocation
npx cap sync`}</Pre>
      <Pre>{`import { Geolocation } from "@capacitor/geolocation";

async function locate() {
  const { coords } = await Geolocation.getCurrentPosition();
  return { lat: coords.latitude, lng: coords.longitude };
}`}</Pre>

      <h2>5. Add live updates with OtaKit</h2>
      <p>Install the plugin and configure your OtaKit app id:</p>
      <Pre>{`npm install @otakit/capacitor-updater
npx cap sync`}</Pre>
      <Pre>{`// capacitor.config.ts
const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "dist/my-app/browser",
  plugins: {
    OtaKit: { appId: "YOUR_OTAKIT_APP_ID" },
  },
};`}</Pre>
      <p>
        Confirm a successful boot from your root component so OtaKit can roll back a bad release
        automatically:
      </p>
      <Pre>{`import { Component, OnInit } from "@angular/core";
import { Capacitor } from "@capacitor/core";
import { OtaKit } from "@otakit/capacitor-updater";

@Component({ selector: "app-root", template: "<router-outlet />" })
export class AppComponent implements OnInit {
  ngOnInit() {
    if (Capacitor.isNativePlatform()) OtaKit.notifyAppReady();
  }
}`}</Pre>
      <p>Install the CLI and ship:</p>
      <Pre>{`npm install -g @otakit/cli
otakit login

ng build --configuration production
otakit upload --release`}</Pre>
      <p>
        After your first store release with the plugin configured, every{' '}
        <Code>otakit upload --release</Code> reaches installed devices on their next launch. Native
        changes still go through the store; your Angular bundle ships over the air &mdash; signed,
        hash-verified, and CDN-delivered with no per-user or bandwidth metering.
      </p>

      <Callout>
        <p>
          Building an Ionic Angular app specifically? See{' '}
          <A href="/blog/ionic-live-updates-with-capacitor">live updates for Ionic apps</A> &mdash;
          the OtaKit setup is the same, and it&apos;s a cheaper Appflow alternative.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        The <A href="/docs/setup">setup guide</A> covers the full flow. Then{' '}
        <A href="/blog/automate-capacitor-ota-releases-github-actions">automate releases in CI</A>{' '}
        and read <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A> to
        ship safely.
      </p>
    </BlogArticle>
  );
}
