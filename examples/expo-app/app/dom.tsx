import Constants from 'expo-constants';
import { usePathname } from 'expo-router';
import { useCallback } from 'react';
import DOMFixture from '../components/DOMFixture';
export default function DOMScreen() {
  const pathname = usePathname();
  const onReady = useCallback(
    async (dom: { version: string; htmlVersion: string }) => {
      if (__DEV__) return;
      const updater: typeof import('@otakit/react-native-updater') = require('@otakit/react-native-updater');
      const response = await fetch('http://127.0.0.1:9042/navigation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pathname,
          dom,
          state: await updater.getState(),
          context: updater.launchContext,
          expoConfig: Constants.expoConfig,
        }),
      });
      if (!response.ok) throw new Error(`Navigation report failed: ${response.status}`);
    },
    [pathname],
  );
  return <DOMFixture label="router navigation" onReady={onReady} dom={{ style: { flex: 1 } }} />;
}
