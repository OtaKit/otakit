import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('quasar-to-ios-android-with-capacitor')!;

export const metadata = blogPostMetadata(post.slug);

export default function QuasarToMobilePage() {
  return (
    <BlogArticle post={post}>
      <p>
        Quasar is unusual among Vue frameworks: it has a Capacitor mode built right into its CLI, so
        going from web app to native iOS and Android is a first-class path rather than a bolt-on.
        Your Quasar components and layouts run unchanged, and you get access to device APIs through
        Capacitor plugins.
      </p>
      <p>
        This guide builds native apps from a Quasar project and adds <A href="/">OtaKit</A> for
        over-the-air updates &mdash; so you can ship web-layer fixes without waiting on a store
        review.
      </p>

      <Callout>
        <p>
          Mental model: Quasar&apos;s Capacitor mode manages the native project for you; OtaKit
          layers live updates on top of the web build it produces.
        </p>
      </Callout>

      <h2>1. Add Capacitor mode</h2>
      <p>
        Quasar scaffolds and manages the Capacitor project under <Code>src-capacitor</Code>. Add the
        mode, then build for it:
      </p>
      <Pre>{`quasar mode add capacitor

# during setup, Quasar asks for an app id and name
# then build and run on a device / simulator
quasar dev -m capacitor -T ios
quasar build -m capacitor -T android`}</Pre>
      <p>
        Under the hood, <Code>quasar build -m capacitor</Code> builds your SPA and syncs it into the
        native project. You work in your normal Quasar source tree; Quasar handles the Capacitor
        wiring.
      </p>

      <h2>2. Use native device features</h2>
      <p>
        Install any Capacitor plugin as usual, then rebuild. Quasar picks it up on the next capacitor
        build:
      </p>
      <Pre>{`npm install @capacitor/camera
quasar build -m capacitor -T ios`}</Pre>
      <Pre>{`import { Camera, CameraResultType } from "@capacitor/camera";

async function takePhoto() {
  const photo = await Camera.getPhoto({ quality: 90, resultType: CameraResultType.Uri });
  return photo.webPath;
}`}</Pre>

      <h2>3. Add live updates with OtaKit</h2>
      <p>Install the plugin, then configure it in the Capacitor config Quasar manages:</p>
      <Pre>{`npm install @otakit/capacitor-updater`}</Pre>
      <Pre>{`// src-capacitor/capacitor.config.json
{
  "appId": "com.example.myapp",
  "appName": "My App",
  "webDir": "www",
  "plugins": {
    "OtaKit": { "appId": "YOUR_OTAKIT_APP_ID" }
  }
}`}</Pre>
      <p>
        Signal a clean boot from a Quasar boot file so OtaKit can roll back a bad release
        automatically:
      </p>
      <Pre>{`// src/boot/otakit.ts
import { boot } from "quasar/wrappers";
import { Capacitor } from "@capacitor/core";
import { OtaKit } from "@otakit/capacitor-updater";

export default boot(() => {
  if (Capacitor.isNativePlatform()) OtaKit.notifyAppReady();
});`}</Pre>
      <p>Register the boot file in <Code>quasar.config</Code>, then release from the built output:</p>
      <Pre>{`npm install -g @otakit/cli
otakit login

quasar build -m capacitor
otakit upload --release --path src-capacitor/www`}</Pre>
      <p>
        Point the CLI at the web build Quasar produced (typically <Code>src-capacitor/www</Code>).
        After your first store release with the plugin configured, each release reaches installed
        devices on the next launch &mdash; signed, hash-verified, and CDN-delivered with no per-user
        or bandwidth metering.
      </p>

      <Callout>
        <p>
          New to the mechanics? Start with{' '}
          <A href="/blog/how-ota-works-for-capacitor-apps">how OTA updates work in Capacitor apps</A>
          .
        </p>
      </Callout>

      <h2>Where to go next</h2>
      <p>
        See the <A href="/docs/setup">setup guide</A>, then{' '}
        <A href="/blog/automate-capacitor-ota-releases-github-actions">automate releases in CI</A>{' '}
        and read <A href="/blog/staged-rollouts-for-capacitor-live-updates">staged rollouts</A>.
      </p>
    </BlogArticle>
  );
}
