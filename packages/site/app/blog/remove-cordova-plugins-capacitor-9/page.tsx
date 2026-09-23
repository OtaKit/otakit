import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('remove-cordova-plugins-capacitor-9')!;

export const metadata = blogPostMetadata(post.slug);

export default function RemoveCordovaPluginsPage() {
  return (
    <BlogArticle post={post}>
      <p>
        The headline feature of Capacitor 9 is that Cordova becomes optional. Today, every Capacitor
        app carries a Cordova compatibility layer so that old <Code>cordova-plugin-*</Code> packages
        keep working. From Capacitor 9, an app with no Cordova plugins can leave that layer out
        entirely. Ionic forecasts Capacitor 9 for the end of November 2026, and 9.0.0-alpha.7 landed
        on 18 September.
      </p>
      <p>
        You do not have to remove Cordova plugins to upgrade. But most apps carry two or three that
        were added years ago and never revisited, and this is the right moment to replace them. It
        means a smaller app, fewer build warnings, and plugins that are actually maintained.
      </p>

      <h2>1. Find every Cordova plugin</h2>
      <p>The Capacitor CLI lists both kinds of plugin:</p>
      <Pre>{`npx cap ls`}</Pre>
      <p>Also check <Code>package.json</Code> directly, because some come in as dependencies of other packages:</p>
      <Pre>{`npm ls --all 2>/dev/null | grep -iE "cordova-plugin|phonegap-plugin|@awesome-cordova-plugins"`}</Pre>
      <p>
        <Code>@awesome-cordova-plugins/*</Code> (formerly <Code>@ionic-native</Code>) are only
        TypeScript wrappers. Each one points to a real Cordova plugin underneath, which is the thing
        to replace.
      </p>

      <h2>2. Replace each plugin</h2>
      <p>Most common Cordova plugins have a direct Capacitor replacement:</p>
      <DataTable
        headers={['Cordova plugin', 'Capacitor replacement']}
        rows={[
          ['cordova-plugin-camera', '@capacitor/camera'],
          ['cordova-plugin-geolocation', '@capacitor/geolocation'],
          ['cordova-plugin-file', '@capacitor/filesystem'],
          ['cordova-plugin-device', '@capacitor/device'],
          ['cordova-plugin-network-information', '@capacitor/network'],
          ['cordova-plugin-statusbar', '@capacitor/status-bar'],
          ['cordova-plugin-splashscreen', '@capacitor/splash-screen'],
          ['cordova-plugin-inappbrowser', '@capacitor/inappbrowser or @capacitor/browser'],
          ['cordova-plugin-dialogs', '@capacitor/dialog'],
          ['cordova-plugin-vibration', '@capacitor/haptics'],
          ['cordova-plugin-x-socialsharing', '@capacitor/share'],
          ['cordova-plugin-local-notification', '@capacitor/local-notifications'],
          ['phonegap-plugin-push / cordova-plugin-firebasex (push)', '@capacitor/push-notifications'],
          ['cordova-plugin-keyboard', '@capacitor/keyboard'],
          ['cordova-plugin-screen-orientation', '@capacitor/screen-orientation'],
          ['cordova-plugin-nativestorage', '@capacitor/preferences'],
          ['phonegap-plugin-barcodescanner', '@capacitor-mlkit/barcode-scanning'],
          ['cordova-plugin-whitelist', 'Not needed in Capacitor; remove it'],
          ['cordova-plugin-code-push', 'A Capacitor live update plugin such as OtaKit'],
          ['cordova-plugin-ionic (Appflow Live Updates)', 'A Capacitor live update plugin such as OtaKit'],
        ]}
      />
      <p>
        APIs differ slightly. Capacitor plugins return promises instead of taking success and error
        callbacks, and option names are not always identical. A typical change:
      </p>
      <Pre>{`// Before: Cordova
navigator.camera.getPicture(onSuccess, onError, {
  quality: 80,
  destinationType: Camera.DestinationType.FILE_URI,
});

// After: Capacitor
import { Camera, CameraResultType } from '@capacitor/camera';

const photo = await Camera.getPhoto({
  quality: 80,
  resultType: CameraResultType.Uri,
});`}</Pre>
      <p>
        If a plugin has no replacement, look for a maintained community plugin in the Capawesome or
        Capacitor Community organizations, or write a small local plugin. A focused local plugin is
        often less code than the Cordova plugin it replaces.
      </p>

      <h2>3. Remove the old plugin completely</h2>
      <Pre>{`npm uninstall cordova-plugin-camera @awesome-cordova-plugins/camera
npx cap sync`}</Pre>
      <p>Then clean up what Cordova leaves behind:</p>
      <ul>
        <li>
          Preferences for the old plugin in <Code>capacitor.config.ts</Code> under{' '}
          <Code>cordova.preferences</Code>.
        </li>
        <li>
          Permission strings in <Code>Info.plist</Code> and <Code>AndroidManifest.xml</Code> that no
          other plugin uses. App Review asks about permissions you declare but do not use.
        </li>
        <li>Any <Code>deviceready</Code> listeners. Capacitor plugins are ready when your app loads.</li>
      </ul>

      <h2>4. Do it one plugin per release</h2>
      <p>
        Each replacement changes native code, so each needs a store build and real-device testing.
        Batching all of them into the Capacitor 9 upgrade means debugging five changes at once. A
        calmer order:
      </p>
      <ol>
        <li>Replace one or two plugins per native release over the next two months.</li>
        <li>
          Finish the <A href="/blog/capacitor-spm-migration">Swift Package Manager migration</A>,
          which Capacitor 9 and the end of CocoaPods Trunk both push you toward.
        </li>
        <li>
          Upgrade to Capacitor 9 when it is stable, as its own release. See{' '}
          <A href="/blog/capacitor-9-what-changes">what changes in Capacitor 9</A>.
        </li>
      </ol>

      <Callout>
        <p>
          <strong>Still on Cordova&apos;s live update plugin?</strong> CodePush was retired with App
          Center, and Appflow is winding down. Replacing that plugin is the most urgent item on this
          list, because a dead update server leaves users stuck on whatever bundle they have. See{' '}
          <A href="/blog/migrate-from-app-center-to-otakit">migrating from App Center</A> and{' '}
          <A href="/blog/ionic-appflow-alternative">Appflow alternatives</A>.
        </p>
      </Callout>

      <h2>5. Keep web and native releases apart</h2>
      <p>
        Plugin replacements are native changes and must go through the stores. The JavaScript that
        calls the new plugin, however, is web code, and it will need adjustments after real users hit
        edge cases: a permission prompt at the wrong moment, a changed file path, a different error
        shape.
      </p>
      <p>
        With <A href="/">OtaKit</A>, those follow-up fixes ship over the air. The CLI compares your
        web build with the native plugins in the store build before it releases, so a bundle that
        calls a plugin users do not have yet is stopped at upload, not discovered as a crash. Bump{' '}
        <Code>runtimeVersion</Code> with each native release that changes the plugin set, and
        OtaKit keeps old and new shells on the right bundles automatically.
      </p>
    </BlogArticle>
  );
}
