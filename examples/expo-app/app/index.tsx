import { Link } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { View } from 'react-native';
import NativeAcceptance from '../components/NativeAcceptance';

const hideSplash = () => SplashScreen.hideAsync();

export default function Home() {
  return (
    <View style={{ flex: 1, padding: 24, gap: 16 }}>
      <NativeAcceptance integration="router" onLocalReady={hideSplash} />
      <Link href="/dom">Open DOM fixture</Link>
    </View>
  );
}
