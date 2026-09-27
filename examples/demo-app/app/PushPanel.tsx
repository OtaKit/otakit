'use client';

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { OtaKitPush } from '@otakit/push';
import { useEffect, useState } from 'react';

// Same app ID as plugins.OtaKit.appId in capacitor.config.ts.
const OTAKIT_APP_ID = '65bb56c1-8279-4a71-a010-7a78ca96e613';

type Line = { time: string; text: string };

export function PushPanel() {
  const [permission, setPermission] = useState('unknown');
  const [token, setToken] = useState<string | null>(null);
  const [sync, setSync] = useState('not synced');
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const log = (text: string) =>
      setLines((prev) => [{ time: new Date().toLocaleTimeString(), text }, ...prev].slice(0, 10));

    OtaKitPush.init({ appId: OTAKIT_APP_ID });
    const handles = [
      PushNotifications.addListener('registration', async ({ value }) => {
        setToken(value);
        log('token received');
        const result = await OtaKitPush.syncToken(value, { topics: ['demo'] });
        setSync(JSON.stringify(result));
        log(`sync: ${result.status}`);
      }),
      PushNotifications.addListener('registrationError', (error) =>
        log(`registration error: ${error.error}`),
      ),
      PushNotifications.addListener('pushNotificationReceived', (notification) =>
        log(`received: ${notification.title ?? ''} — ${notification.body ?? ''}`),
      ),
      PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) =>
        log(`opened: ${String(notification.data?.url ?? '(no url)')}`),
      ),
    ];

    void (async () => {
      // iOS issues a device token without the alert permission, so register first;
      // Android 13+ only delivers visible notifications after the grant.
      if (Capacitor.getPlatform() === 'ios') await PushNotifications.register();
      const status = await PushNotifications.requestPermissions();
      setPermission(status.receive);
      if (Capacitor.getPlatform() !== 'ios') await PushNotifications.register();
    })();

    return () => {
      void Promise.all(handles).then((list) => list.forEach((handle) => handle.remove()));
    };
  }, []);

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <h2 className="text-sm font-semibold text-cyan-200">Push (OtaKit Push)</h2>
      <dl className="mt-2 space-y-1 text-xs text-slate-300">
        <div>
          <dt className="inline text-slate-500">permission: </dt>
          <dd className="inline">{permission}</dd>
        </div>
        <div>
          <dt className="inline text-slate-500">token: </dt>
          <dd className="inline break-all font-mono">{token ? `${token.slice(0, 16)}…` : '—'}</dd>
        </div>
        <div>
          <dt className="inline text-slate-500">sync: </dt>
          <dd className="inline font-mono">{sync}</dd>
        </div>
      </dl>
      <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-slate-400">
        {lines.map((line, index) => (
          <li key={index}>
            {line.time} {line.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
