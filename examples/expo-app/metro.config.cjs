const { getDefaultConfig } = require('expo/metro-config');
const { withOtaKitMetro } = require('@otakit/react-native-updater/metro');
module.exports = withOtaKitMetro(getDefaultConfig(__dirname));
