/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { backgroundWork } from './background-work';

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask('OtaKitBackgroundFixture', () => async () => {
  backgroundWork.started = true;
  await new Promise((resolve) => setTimeout(resolve, 30_000));
});
