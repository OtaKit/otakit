const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withOtaKitMetro } = require('@otakit/react-native-updater/metro');
const path = require('node:path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [path.resolve(__dirname, '../..')],
  maxWorkers: 2,
  resolver: { nodeModulesPaths: [path.join(__dirname, 'node_modules')] },
};

module.exports = withOtaKitMetro(mergeConfig(getDefaultConfig(__dirname), config));
