import { BlogArticle, Callout, Code, Pre, A, DataTable } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-push-notifications-without-firebase-ios')!;

export const metadata = blogPostMetadata(post.slug);

export default function PushWithoutFirebaseIosPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Most Capacitor push tutorials start the same way: create a Firebase project, add{' '}
        <Code>GoogleService-Info.plist</Code> to Xcode, pull in the Firebase iOS SDK. On Android
        that is unavoidable, because Firebase Cloud Messaging is how Google delivers push. On iOS it
        is optional. Apple&apos;s own service, APNs, is what actually delivers every notification to
        an iPhone, and your app can talk to it without any Firebase code at all.
      </p>
      <p>
        This guide sets up push notifications for a Capacitor app on iOS with APNs directly, keeps
        Firebase only where it is required (Android), and sends from one place for both platforms.
      </p>

      <Callout>
        <p>
          <strong>The short version.</strong> The official{' '}
          <Code>@capacitor/push-notifications</Code> plugin already returns the native APNs device
          token on iOS. Send that token to a server that holds your APNs key, and it can deliver to
          the phone. No Firebase SDK in the iOS app.
        </p>
      </Callout>

      <h2>Why skip Firebase on iOS?</h2>
      <ul>
        <li>
          <strong>Less native code.</strong> No Firebase pods or Swift packages, no{' '}
          <Code>GoogleService-Info.plist</Code>, no method swizzling to reason about.
        </li>
        <li>
          <strong>One less hop.</strong> FCM on iOS forwards to APNs anyway. Going direct means one
          set of error codes, from Apple, that you can act on.
        </li>
        <li>
          <strong>Smaller privacy surface.</strong> One fewer third-party SDK to list in your App
          Store privacy details.
        </li>
      </ul>
      <p>
        What you give up: FCM topic messaging on iOS and the Firebase console&apos;s composer. Both
        are easy to replace on the server side, as shown below.
      </p>

      <h2>What you need</h2>
      <DataTable
        headers={['Platform', 'Credential', 'Where it comes from']}
        rows={[
          [
            'iOS',
            'APNs key (.p8), Key ID, Team ID, bundle ID',
            'Apple Developer → Certificates, IDs & Profiles → Keys',
          ],
          [
            'Android',
            'Firebase service account JSON + google-services.json',
            'Firebase console → Project settings',
          ],
        ]}
      />
      <p>
        One APNs key works for every app in your team and for both development and production
        builds, so you usually create it once.
      </p>

      <h2>1. Create the APNs key</h2>
      <ol>
        <li>
          In the Apple Developer account, open <strong>Keys</strong>, add a key and enable{' '}
          <strong>Apple Push Notifications service (APNs)</strong>.
        </li>
        <li>
          Download the <Code>.p8</Code> file. Apple lets you download it only once, so store it
          safely.
        </li>
        <li>
          Note the Key ID and your Team ID. Check that your bundle ID exists under{' '}
          <strong>Identifiers</strong> with the Push Notifications capability, in the same team.
        </li>
      </ol>

      <h2>2. Prepare the iOS project</h2>
      <p>
        Install the plugin, then in Xcode add the <strong>Push Notifications</strong> capability to
        your app target:
      </p>
      <Pre>{`npm install @capacitor/push-notifications
npx cap sync ios`}</Pre>
      <p>
        Capacitor needs two small methods in <Code>AppDelegate.swift</Code> to hand the token to the
        plugin:
      </p>
      <Pre>{`func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
}

func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
}`}</Pre>
      <p>That is all the native work. Nothing Firebase-related goes into the iOS project.</p>

      <h2>3. Get the token in your app</h2>
      <Pre>{`import { PushNotifications } from '@capacitor/push-notifications';

PushNotifications.addListener('registration', ({ value }) => {
  // On iOS this is the APNs token: 64 hex characters.
  // On Android it is an FCM registration token.
  sendTokenToYourServer(value);
});

const { receive } = await PushNotifications.requestPermissions();
if (receive === 'granted') {
  await PushNotifications.register();
}`}</Pre>
      <p>
        Note the difference: the same listener gives you an APNs token on iOS and an FCM token on
        Android. Whatever sends your notifications has to know which is which and use the right
        service for each.
      </p>

      <h2>4. Send to APNs</h2>
      <p>
        Sending to APNs is an HTTP/2 request to <Code>api.push.apple.com</Code>, authenticated with
        a short-lived JWT signed by your <Code>.p8</Code> key (ES256). The details that trip people
        up:
      </p>
      <ul>
        <li>
          <strong>HTTP/2 only.</strong> Plain <Code>fetch</Code> in many runtimes speaks HTTP/1.1;
          in Node use <Code>node:http2</Code>.
        </li>
        <li>
          <strong>Reuse the JWT.</strong> Apple rejects tokens refreshed too often
          (TooManyProviderTokenUpdates). Cache it for about 50 minutes.
        </li>
        <li>
          <strong>Sandbox vs production.</strong> Builds run from Xcode get sandbox tokens, which
          only work on <Code>api.sandbox.push.apple.com</Code>. TestFlight and App Store builds use
          production.
        </li>
        <li>
          <strong>Clean up.</strong> <Code>410 Unregistered</Code> and{' '}
          <Code>400 BadDeviceToken</Code> mean the token is dead. Delete it, or your device counts
          drift upward forever.
        </li>
        <li>
          <strong>4 KB limit.</strong> The JSON payload, including your custom data, must fit in
          4,096 bytes.
        </li>
      </ul>
      <p>
        None of this is hard, but together with Android (a different API, OAuth tokens from a
        service account, different error codes) it adds up to a small service you now own.
      </p>

      <h2>The shortcut: let OtaKit send</h2>
      <p>
        <A href="/push">OtaKit Push</A> is that service, free for Capacitor apps. You upload the
        APNs key and the Firebase service account once, register tokens with a small helper, and
        send to both platforms from the dashboard, the CLI or your backend. iOS goes straight to
        APNs; only Android uses Firebase.
      </p>
      <Pre>{`npm install @capacitor/push-notifications @otakit/push`}</Pre>
      <Pre>{`import { OtaKitPush } from '@otakit/push';

OtaKitPush.init({ appId: 'YOUR_OTAKIT_APP_ID' });

PushNotifications.addListener('registration', ({ value }) => {
  OtaKitPush.syncToken(value, { userId: currentUser?.id ?? null });
});`}</Pre>
      <p>Then send from anywhere:</p>
      <Pre>{`otakit push send --title "Your order shipped" --body "Track it in the app" --url /orders --platform ios`}</Pre>
      <p>
        OtaKit handles the HTTP/2 connection, token caching, sandbox builds (a development token is
        detected on the first send and delivered through the sandbox), invalid-token cleanup and
        retries. The free plan covers 10,000 devices and 100,000 notifications a month. Setup
        details are in the <A href="/docs/push">push docs</A>.
      </p>

      <h2>Testing on the simulator</h2>
      <p>
        Since Xcode 14 on Apple silicon Macs, the iOS simulator receives real remote notifications,
        with a sandbox token like a debug build on a device. You can also drag an <Code>.apns</Code>{' '}
        file onto the simulator, or run{' '}
        <Code>xcrun simctl push booted your.bundle.id payload.apns</Code>, to test how your app
        handles a notification without any server.
      </p>

      <h2>Android still needs Firebase</h2>
      <p>
        On Android there is no way around FCM for standard push: add{' '}
        <Code>google-services.json</Code> to <Code>android/app/</Code> and the Capacitor template
        applies the Google Services plugin for you. On Android 13 and newer, notifications appear
        only after the user grants the notification permission. For the full Firebase route on both
        platforms, see <A href="/blog/capacitor-push-notifications-firebase">our Firebase guide</A>.
      </p>
    </BlogArticle>
  );
}
