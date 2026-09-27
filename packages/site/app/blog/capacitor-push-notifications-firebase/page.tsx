import { BlogArticle, Callout, Code, Pre, A } from '../_components/BlogArticle';
import { blogPostMetadata, getBlogPost } from '@/lib/blog';

const post = getBlogPost('capacitor-push-notifications-firebase')!;

export const metadata = blogPostMetadata(post.slug);

export default function PushNotificationsPage() {
  return (
    <BlogArticle post={post}>
      <p>
        Push notifications are table stakes for a real mobile app, and Firebase Cloud Messaging
        (FCM) is the standard way to deliver them to both iOS and Android from a Capacitor app. This
        guide walks through the full setup &mdash; native config, permissions, tokens, and handling
        taps &mdash; and shows where <A href="/">OtaKit</A> lets you iterate the notification logic
        without a rebuild.
      </p>

      <Callout>
        <p>
          Split the work in your head: the <strong>native wiring</strong> (FCM, APNs, the push
          plugin) is a one-time store build. The <strong>notification handling logic</strong>{' '}
          &mdash; routing a tap, formatting content, deciding what to show &mdash; lives in your web
          layer and ships over the air.
        </p>
      </Callout>

      <h2>1. Install the push plugin</h2>
      <Pre>{`npm install @capacitor/push-notifications
npx cap sync`}</Pre>

      <h2>2. Set up Firebase</h2>
      <ul>
        <li>Create a Firebase project and register your iOS and Android apps.</li>
        <li>
          Add <Code>google-services.json</Code> to the Android project and{' '}
          <Code>GoogleService-Info.plist</Code> to the iOS project.
        </li>
        <li>For iOS, upload your APNs key to Firebase &mdash; FCM delivers to iOS through APNs.</li>
      </ul>

      <Callout>
        <p>
          On iOS, <Code>@capacitor/push-notifications</Code> returns the native APNs token, not an
          FCM token. To send through FCM on iOS you need a Firebase messaging plugin that returns
          FCM tokens; or skip Firebase on iOS and send to APNs directly, as in{' '}
          <A href="/blog/capacitor-push-notifications-without-firebase-ios">
            push notifications on iOS without Firebase
          </A>
          .
        </p>
      </Callout>

      <h2>3. Request permission and register</h2>
      <Pre>{`import { PushNotifications } from '@capacitor/push-notifications';

const perm = await PushNotifications.requestPermissions();
if (perm.receive === 'granted') {
  await PushNotifications.register();
}

PushNotifications.addListener('registration', (token) => {
  // send token.value to your backend to target this device
  saveDeviceToken(token.value);
});`}</Pre>

      <h2>4. Handle received notifications and taps</h2>
      <Pre>{`PushNotifications.addListener('pushNotificationReceived', (notification) => {
  // app in foreground — show your own in-app UI
});

PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
  // user tapped — route to the right screen
  router.navigate(action.notification.data.route);
});`}</Pre>
      <p>
        This routing logic is pure web-layer code. When you change how a tap routes, or tweak the
        in-app presentation, ship it over the air:
      </p>
      <Pre>{`otakit upload --release production`}</Pre>

      <Callout>
        <p>
          Common gotcha: iOS push requires the Push Notifications capability. The simulator receives
          remote push on Apple silicon Macs with Xcode 14 or newer (sandbox tokens). Android needs
          the notification permission on API 33+. Both are native concerns &mdash; get them right in
          the store build.
        </p>
      </Callout>

      <h2>Sending without running your own server</h2>
      <p>
        The steps above give you device tokens; something still has to send to them.{' '}
        <A href="/push">OtaKit Push</A> does that for free: upload your APNs key and Firebase
        service account, register tokens with <Code>@otakit/push</Code>, and send from the
        dashboard, CLI or your backend. See the <A href="/docs/push">push docs</A>.
      </p>

      <h2>Where to go next</h2>
      <p>
        See <A href="/docs/setup">Setup</A> to add OtaKit alongside the push plugin, and{' '}
        <A href="/blog/capacitor-deep-links-universal-links">deep links</A> since notification taps
        and deep links often share routing.
      </p>
    </BlogArticle>
  );
}
