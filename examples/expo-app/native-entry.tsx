// Device acceptance entry independent of the unresolved Router asset collision.
import { registerRootComponent } from 'expo';
import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import DOMFixture from './components/DOMFixture';

function NativeFixture() {
  const [status, setStatus] = useState('starting');
  const [domReady, setDomReady] = useState(false);
  const onDOMReady = useCallback(async () => setDomReady(true), []);
  useEffect(() => {
    if (!domReady) return;
    if (__DEV__) {
      setStatus('Metro development');
      return;
    }
    const updater: typeof import('@otakit/react-native-updater') = require('@otakit/react-native-updater');
    void updater
      .notifyAppReady()
      .then(async () => {
        const state = await updater.getState();
        setStatus(`ready ${state.generation}`);
        await fetch('http://127.0.0.1:9042/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state,
            context: updater.launchContext,
            expoConfig: Constants.expoConfig,
            domReady,
          }),
        });
      })
      .catch((error: Error) => setStatus(error.message));
  }, [domReady]);
  return (
    <View style={{ flex: 1, paddingTop: 60 }}>
      <Text>Expo {Constants.expoConfig?.extra?.fixtureVersion}</Text>
      <Text>{status}</Text>
      <DOMFixture label="native acceptance" onReady={onDOMReady} dom={{ style: { height: 240 } }} />
    </View>
  );
}
registerRootComponent(NativeFixture);
