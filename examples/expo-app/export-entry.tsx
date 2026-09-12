// Independent Expo/DOM export acceptance while Router's SDK 57 icon collision is unresolved.
import { registerRootComponent } from 'expo';
import Constants from 'expo-constants';
import { Text, View } from 'react-native';
import DOMFixture from './components/DOMFixture';

function ExportFixture() {
  return (
    <View>
      <Text>Expo {Constants.expoConfig?.extra?.fixtureVersion}</Text>
      <DOMFixture label="export acceptance" />
    </View>
  );
}
registerRootComponent(ExportFixture);
