import { Separator } from '@/components/ui/separator';
import { Pre } from '@/app/docs/CodeBlock';

export const metadata = {
  title: 'Push Notifications',
  description:
    'Free push notifications for Capacitor apps: upload your APNs key and Firebase service account, register devices with @otakit/push, and send from the dashboard, CLI, API or an AI agent.',
};

export default function PushDocsPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Push Notifications</h1>
      <P>
        OtaKit sends push notifications to your Capacitor app on iOS and Android. It uses the
        official <Code>@capacitor/push-notifications</Code> plugin on the device and talks to Apple
        (APNs) and Google (Firebase Cloud Messaging) directly with your own keys. There is no extra
        native SDK, and it works with or without OtaKit live updates.
      </P>
      <P>
        Push is an add-on. Turn it on per workspace in the dashboard under{' '}
        <strong>Settings → Add-ons → Push notifications</strong>; a Push page then appears in the
        menu.
      </P>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">1. Upload your keys</h2>
      <P>
        Open <strong>Push → Setup</strong> and choose the app. Only workspace owners and admins can
        upload keys. Keys are encrypted at rest and never shown again after upload.
      </P>

      <H3>iOS: APNs key</H3>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          In the Apple Developer account, open{' '}
          <strong>Certificates, IDs &amp; Profiles → Keys</strong>, create a key with{' '}
          <strong>Apple Push Notifications service (APNs)</strong> enabled, and download the{' '}
          <Code>.p8</Code> file (Apple lets you download it once).
        </li>
        <li>
          Note the <strong>Key ID</strong> (10 characters) and your <strong>Team ID</strong> (top
          right of the developer account).
        </li>
        <li>
          Make sure your bundle ID is registered under <strong>Identifiers</strong> with the Push
          Notifications capability, in the same team as the key.
        </li>
        <li>
          Upload the <Code>.p8</Code> file with the Key ID, Team ID and bundle ID, then click{' '}
          <strong>Test</strong>. One key works for development and production builds.
        </li>
      </ol>

      <H3>Android: Firebase service account</H3>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          In the Firebase console, add an Android app with your application ID and download{' '}
          <Code>google-services.json</Code> (you need it in step 2).
        </li>
        <li>
          Open <strong>Project settings → Service accounts</strong> and click{' '}
          <strong>Generate new private key</strong>.
        </li>
        <li>
          Upload the JSON file and click <strong>Test</strong>. A key created a minute ago can be
          rejected briefly while Google activates it.
        </li>
      </ol>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">2. Install</h2>
      <Pre>{`npm install @capacitor/push-notifications @otakit/push
npx cap sync`}</Pre>

      <H3>iOS project</H3>
      <P>
        In Xcode, add the <strong>Push Notifications</strong> capability to the app target, then add
        the two <Code>AppDelegate</Code> methods from the{' '}
        <a
          href="https://capacitorjs.com/docs/apis/push-notifications"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          Capacitor push notifications guide
        </a>
        :
      </P>
      <Pre>{`func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
}

func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
}`}</Pre>

      <H3>Android project</H3>
      <P>
        Copy <Code>google-services.json</Code> to <Code>android/app/</Code>. The Capacitor Android
        template applies the Google Services plugin when the file is present. Android 13 and newer
        show notifications only after the user grants the notification permission.
      </P>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">3. Register devices</h2>
      <Pre>{`import { PushNotifications } from '@capacitor/push-notifications';
import { OtaKitPush } from '@otakit/push';

OtaKitPush.init({ appId: 'YOUR_OTAKIT_APP_ID' });

PushNotifications.addListener('registration', ({ value }) => {
  OtaKitPush.syncToken(value, { userId: currentUser?.id ?? null, topics: ['news'] });
});

const permission = await PushNotifications.requestPermissions();
if (permission.receive === 'granted') {
  await PushNotifications.register();
}

// Open a screen when the user taps a notification.
PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
  const url = notification.data?.url;
  if (url) router.push(url);
});`}</Pre>
      <P>
        The app ID is the same one you use for live updates (<Code>plugins.OtaKit.appId</Code>). The
        device appears under <strong>Push → Devices</strong> within seconds.
      </P>

      <H3>OtaKitPush API</H3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 pr-4 font-medium">Method</th>
              <th className="py-2 font-medium">What it does</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            {API_ROWS.map(([method, description]) => (
              <tr key={method} className="border-b border-border align-top">
                <td className="py-2 pr-4">
                  <Code>{method}</Code>
                </td>
                <td className="py-2">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <P>
        Every method resolves with a status instead of throwing, so push setup never breaks your
        app. When OtaKit live updates are installed, the device&apos;s OTA channel and bundle
        version are attached automatically, so you can target by channel.
      </P>

      <H3>Development builds</H3>
      <P>
        Builds run from Xcode get sandbox tokens. On the first send, OtaKit notices when Apple
        rejects such a token on production, delivers it through the sandbox instead, and remembers
        that for the device. You can also pass <Code>{`environment: 'sandbox'`}</Code> to{' '}
        <Code>init</Code> in debug builds.
      </P>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">4. Send</h2>
      <P>
        <strong>Dashboard:</strong> Push → Send. Write the title and text, choose the audience, and
        check the device count before you confirm.
      </P>
      <P>
        <strong>CLI</strong> (<Code>@otakit/cli</Code> 1.7.0 or newer):
      </P>
      <Pre>{`otakit push send --title "Your order shipped" --body "Track it in the app" --url /orders --user user_42
otakit push campaigns`}</Pre>
      <P>
        <strong>REST API</strong> with an organization key. Preview first to see the audience, then
        send with an idempotency key so a retry never sends twice:
      </P>
      <Pre>{`curl -X POST https://console.otakit.app/api/v1/apps/$APP_ID/push/campaigns \\
  -H "Authorization: Bearer $OTAKIT_TOKEN" \\
  -H "Idempotency-Key: order-42-shipped" \\
  -H "Content-Type: application/json" \\
  -d '{
    "payload": { "title": "Your order shipped", "body": "Track it in the app", "url": "/orders" },
    "audience": { "userIds": ["user_42"] }
  }'`}</Pre>
      <P>
        <Code>POST …/push/audience</Code> takes the same body and returns the device count and
        warnings without sending. <Code>GET …/push/campaigns/:id</Code> returns delivery counts.
      </P>

      <H3>Message</H3>
      <P>
        <Code>title</Code> (up to 100 characters) and <Code>body</Code> (up to 1,000) are required.
        Optional: <Code>url</Code> (a path like <Code>/inbox</Code> or an https link, delivered as{' '}
        <Code>data.url</Code>), <Code>data</Code> (up to 20 string values), <Code>sound</Code>,{' '}
        <Code>badge</Code> and <Code>ttlSeconds</Code> (default one day). The whole message must fit
        Apple&apos;s 4 KB limit.
      </P>

      <H3>Audience</H3>
      <P>
        Filter by <Code>platforms</Code>, <Code>topics</Code>, <Code>userIds</Code>,{' '}
        <Code>channels</Code> (OTA channel), <Code>runtimeVersions</Code> or <Code>deviceIds</Code>.
        Different filters must all match; values inside one filter match any. An empty audience
        sends to every device of the app.
      </P>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">Limits</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 pr-4 font-medium">Plan</th>
              <th className="py-2 pr-4 font-medium">Devices</th>
              <th className="py-2 font-medium">Notifications per month</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            {LIMIT_ROWS.map(([plan, devices, sends]) => (
              <tr key={plan} className="border-b border-border">
                <td className="py-2 pr-4">{plan}</td>
                <td className="py-2 pr-4">{devices}</td>
                <td className="py-2">{sends}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <P>
        Over the device limit, new devices are not stored and the app is told why; it keeps working.
        Invalid tokens reported by Apple or Google are removed automatically.
      </P>

      <Separator className="my-10" />

      <h2 className="text-xl font-semibold tracking-tight">Troubleshooting</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 pr-4 font-medium">You see</th>
              <th className="py-2 font-medium">Fix</th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            {TROUBLESHOOTING.map(([problem, fix]) => (
              <tr key={problem} className="border-b border-border align-top">
                <td className="py-2 pr-4">
                  <Code>{problem}</Code>
                </td>
                <td className="py-2">{fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const API_ROWS: Array<[string, string]> = [
  [
    'init({ appId, serverUrl?, environment? })',
    'Configure once at startup. serverUrl is for self-hosted consoles.',
  ],
  [
    'syncToken(token, { userId?, topics? })',
    'Register or update the device. Sends only when something changed, or once a day.',
  ],
  ['setUser(userId | null)', 'Attach your own user ID after sign-in, or clear it on sign-out.'],
  ['subscribe(topic) / unsubscribe(topic)', 'Manage topics: letters, digits, - and _, up to 20.'],
  ['unregister()', 'Remove this device from OtaKit.'],
];

const LIMIT_ROWS: Array<[string, string, string]> = [
  ['Free', '10,000', '100,000'],
  ['Starter', '50,000', '1,000,000'],
  ['Pro', '250,000', '5,000,000'],
  ['Enterprise', 'Custom', 'Custom'],
];

const TROUBLESHOOTING: Array<[string, string]> = [
  [
    'PUSH_DISABLED',
    'Turn on Push notifications in Settings → Add-ons. Until then, devices are not registered.',
  ],
  [
    'InvalidProviderToken',
    'Apple rejected the key. Check the Key ID and Team ID, and that the key has APNs enabled.',
  ],
  [
    'TopicDisallowed / BadTopic',
    'The key cannot send to this bundle ID. Register the bundle ID with Push Notifications in the same Apple team as the key.',
  ],
  [
    'BadDeviceToken / Unregistered',
    'The token is no longer valid (app deleted or reinstalled). OtaKit removes it; the app registers again on next launch.',
  ],
  [
    'PERMISSION_DENIED',
    'Google rejected the service account. Wait a minute after creating a key, and check that the Firebase Cloud Messaging API is enabled.',
  ],
  [
    'SENDER_ID_MISMATCH',
    'The device token belongs to a different Firebase project than the uploaded service account.',
  ],
  [
    'No devices match this audience',
    'Check the filters, and that devices appear under Push → Devices. iOS devices need an APNs key, Android devices a Firebase key.',
  ],
  [
    'accepted: false, device_limit',
    'The workspace reached its device limit. Upgrade the plan or remove unused devices.',
  ],
];

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-sm font-semibold tracking-tight">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-muted-foreground">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
}
