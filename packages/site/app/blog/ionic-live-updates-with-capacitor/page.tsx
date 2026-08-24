import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('ionic-live-updates-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function IonicLiveUpdatesPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Ionic apps run on Capacitor, which means they can update over the air &mdash; ship a bug fix
        or a new screen straight to installed devices without a store review. Ionic&apos;s own
        answer is Appflow Live Updates, but it&apos;s bundled into a broader paid platform. If you
        just want live updates for your Ionic app, <A href="/">OtaKit</A> does exactly that, for a
        fraction of the cost.
      </p>
      <p>
        This guide adds live updates to an Ionic app &mdash; Angular, React, or Vue &mdash; with
        OtaKit.
      </p>

      <Callout>
        <p>
          Mental model: your Ionic app is already a Capacitor app. Adding OtaKit is a plugin install
          plus one CLI command, not a migration.
        </p>
      </Callout>

      <h2>Confirm your Capacitor setup</h2>
      <p>
        Modern Ionic projects already use Capacitor. Check that you have the native platforms and
        know your web output directory &mdash; it&apos;s <Code>www</Code> for Ionic Angular and{' '}
        <Code>dist</Code> for Ionic React/Vue:
      </p>
      <Pre>{`ionic build            # produces www/ (Angular) or dist/ (React/Vue)
npx cap sync`}</Pre>
      <p>
        If you&apos;re still on Cordova, migrate to Capacitor first &mdash; it&apos;s the supported
        path and unlocks the modern plugin ecosystem.
      </p>

      <h2>Install OtaKit</h2>
      <Pre>{`npm install @otakit/capacitor-updater
npx cap sync`}</Pre>
      <Pre>{`// capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.myapp",
  appName: "My App",
  webDir: "www", // or "dist" for Ionic React/Vue
  plugins: {
    OtaKit: { appId: "YOUR_OTAKIT_APP_ID" },
  },
};

export default config;`}</Pre>

      <h2>Signal a successful boot</h2>
      <p>
        Call <Code>notifyAppReady()</Code> once your app has loaded so OtaKit can roll back a broken
        release automatically. In Ionic Angular:
      </p>
      <Pre>{`import { Component } from "@angular/core";
import { Capacitor } from "@capacitor/core";
import { OtaKit } from "@otakit/capacitor-updater";

@Component({ selector: "app-root", templateUrl: "app.component.html" })
export class AppComponent {
  constructor() {
    if (Capacitor.isNativePlatform()) OtaKit.notifyAppReady();
  }
}`}</Pre>
      <p>
        In Ionic React or Vue, place the same call in your root component&apos;s mount effect.
      </p>

      <h2>Release your first live update</h2>
      <Pre>{`npm install -g @otakit/cli
otakit login

ionic build
otakit upload --release`}</Pre>
      <p>
        Publish the app to the stores once with the plugin configured. After that, every{' '}
        <Code>otakit upload --release</Code> reaches installed devices on their next launch. Bundles
        are signed, hash-verified, CDN-delivered, and optionally end-to-end encrypted &mdash; with no
        monthly-active-user or bandwidth metering.
      </p>

      <h2>Why teams move off Appflow for this</h2>
      <ul>
        <li>
          <strong>Pricing.</strong> Appflow is a platform subscription; OtaKit doesn&apos;t meter
          MAUs or bandwidth, so most apps pay $0&ndash;25/mo.
        </li>
        <li>
          <strong>No lock-in.</strong> OtaKit&apos;s stack is open source and self-hostable.
        </li>
        <li>
          <strong>Same capability.</strong> Signed, rollback-safe live updates with channels and
          runtime versions.
        </li>
      </ul>

      <Callout>
        <p>
          Comparing options directly? See{' '}
          <A href="/blog/ionic-appflow-alternative">the best Appflow alternative</A> and{' '}
          <A href="/blog/capacitor-vs-appflow">Capacitor + OtaKit vs Appflow</A>.
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        Read <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A> to ship
        safely, and <A href="/blog/how-ota-works-for-capacitor-apps">how OTA works</A> for the full
        delivery model.
      </p>
    </BlogArticle>
  );
}
