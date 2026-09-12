import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { notifyAppReady } from '@otakit/react-native-updater';

void SplashScreen.preventAutoHideAsync();
export default function Layout() {
  useEffect(() => {
    void notifyAppReady().then(() => SplashScreen.hideAsync());
  }, []);
  return <Stack />;
}
