import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import DOMFixture from './DOMFixture';

const nativeVersion = 'OTAKIT_EXPO_NATIVE_EMBEDDED';

export default function NativeAcceptance({
  integration = 'native',
  onLocalReady,
}: {
  integration?: 'native' | 'router';
  onLocalReady?: () => Promise<void>;
}) {
  const [status, setStatus] = useState('starting');
  const [dom, setDOM] = useState<{ version: string; htmlVersion: string } | null>(null);
  const onDOMReady = useCallback(async (content: { version: string; htmlVersion: string }) => {
    setDOM((previous) =>
      previous?.version === content.version && previous.htmlVersion === content.htmlVersion
        ? previous
        : content,
    );
  }, []);
  useEffect(() => {
    if (!dom) return;
    if (__DEV__) {
      void (onLocalReady?.() ?? Promise.resolve())
        .then(() => setStatus('Metro development'))
        .catch((error: Error) => setStatus(error.message));
      return;
    }
    const updater: typeof import('@otakit/react-native-updater') = require('@otakit/react-native-updater');
    let splashHideCompleted = false;
    async function report(phase: string) {
      const state = await updater.getState();
      setStatus(`${phase} ${state.generation}`);
      const response = await fetch('http://127.0.0.1:9042/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state,
          context: updater.launchContext,
          expoConfig: Constants.expoConfig,
          domReady: true,
          dom,
          nativeVersion,
          phase,
          integration,
          splashHideCompleted,
        }),
      });
      if (!response.ok) throw new Error(`Report failed: ${response.status}`);
      return response.json();
    }
    void (async () => {
      await onLocalReady?.();
      splashHideCompleted = onLocalReady !== undefined;
      // The signed bad fixture intentionally never confirms its trial generation.
      const fatal = nativeVersion.endsWith('_CRASH');
      const unconfirmed = nativeVersion.endsWith('_BAD') || fatal;
      if (!unconfirmed) await updater.notifyAppReady();
      const action = await report(unconfirmed ? 'unconfirmed' : 'ready');
      if (fatal) {
        // Escape the async report's catch: exercise RN's real fatal exception handler.
        setTimeout(() => {
          throw new Error('OTAKIT_EXPO_INTENTIONAL_FATAL');
        }, 250);
        return;
      }
      if (action.update) {
        await updater.check();
        await updater.download();
        await report('staged');
        await updater.apply();
      }
    })().catch((error: Error) => setStatus(error.message));
  }, [dom, integration, onLocalReady]);
  return (
    <View style={{ flex: 1, paddingTop: integration === 'router' ? 16 : 60 }}>
      <Text>Expo {Constants.expoConfig?.extra?.fixtureVersion}</Text>
      <Text>{status}</Text>
      <DOMFixture label="native acceptance" onReady={onDOMReady} dom={{ style: { height: 240 } }} />
    </View>
  );
}
