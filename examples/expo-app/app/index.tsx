import { Link } from 'expo-router';
import Constants from 'expo-constants';
import { Text, View } from 'react-native';
import { launchContext } from '@otakit/react-native-updater';

export default function Home() {
  return (
    <View style={{ padding: 24, gap: 16 }}>
      <Text>OtaKit Expo fixture: {Constants.expoConfig?.extra?.fixtureVersion}</Text>
      <Text>{JSON.stringify(launchContext)}</Text>
      <Link href="/dom">Open DOM fixture</Link>
    </View>
  );
}
