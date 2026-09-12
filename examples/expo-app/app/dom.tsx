import { usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import NativeAcceptance from '../components/NativeAcceptance';

const hideSplash = () => SplashScreen.hideAsync();

export default function DOMScreen() {
  // A deep link can be the first mounted screen. It must perform the same local
  // initialization, splash completion and readiness as the home route.
  const pathname = usePathname();
  return (
    <NativeAcceptance integration="router" onLocalReady={hideSplash} navigationPath={pathname} />
  );
}
