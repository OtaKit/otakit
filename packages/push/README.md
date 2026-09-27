# @otakit/push

Free push notifications for Capacitor apps with [OtaKit](https://otakit.app). This small helper
registers the device token from the official `@capacitor/push-notifications` plugin with OtaKit,
so you can send pushes from the OtaKit dashboard, API, CLI or an AI agent.

- No extra native SDK: iOS uses APNs directly, Android uses Firebase Cloud Messaging.
- Target by platform, topic, your own user ID, or the OTA release channel of the device (when the
  OtaKit updater is installed, the channel and bundle are attached automatically).

## Install

```bash
npm install @capacitor/push-notifications @otakit/push
npx cap sync
```

Upload your APNs key and/or Firebase service account in the OtaKit dashboard first. On iOS, add
the Push Notifications capability and the two `AppDelegate` methods from the
[Capacitor push notifications guide](https://capacitorjs.com/docs/apis/push-notifications). On
Android, add `google-services.json`.

## Use

```ts
import { PushNotifications } from '@capacitor/push-notifications';
import { OtaKitPush } from '@otakit/push';

OtaKitPush.init({ appId: 'YOUR_OTAKIT_APP_ID' });

PushNotifications.addListener('registration', ({ value }) => {
  OtaKitPush.syncToken(value, { userId: currentUser?.id ?? null, topics: ['news'] });
});

const permission = await PushNotifications.requestPermissions();
if (permission.receive === 'granted') {
  await PushNotifications.register();
}

PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
  const url = notification.data?.url;
  if (url) router.push(url);
});
```

## API

| Method | Description |
|---|---|
| `init({ appId, serverUrl?, environment? })` | Configure once. `serverUrl` for self-hosting; `environment: 'sandbox'` for Xcode debug builds (also detected automatically). |
| `syncToken(token, { userId?, topics? })` | Register or update the device. Sends only when something changed, or once a day. |
| `setUser(userId \| null)` | Attach or clear your own user ID. |
| `subscribe(topic)` / `unsubscribe(topic)` | Manage topics (`[A-Za-z0-9_-]{1,64}`, up to 20). |
| `unregister()` | Remove this device, e.g. on sign-out. |

All methods resolve with a status instead of throwing on network errors or plan limits, so push
setup can never break your app.

## License

MIT
