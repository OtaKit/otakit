// Private fixture wiring for the generated Expo template; not the public installer.
const { withAppDelegate, withPodfile, withXcodeProject } = require('expo/config-plugins');

function replaceOnce(contents, original, replacement) {
  if (contents.includes(replacement)) return contents;
  if (contents.split(original).length !== 2) throw new Error('Unsupported Expo fixture template');
  return contents.replace(original, replacement);
}
module.exports = function withIOSFixture(config) {
  config = withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') throw new Error('Expected Swift Expo AppDelegate');
    config.modResults.contents = replaceOnce(
      config.modResults.contents,
      'internal import Expo',
      'internal import Expo\ninternal import OtaKitExpoHostFixture',
    );
    config.modResults.contents = replaceOnce(
      config.modResults.contents,
      'class ReactNativeDelegate: ExpoReactNativeFactoryDelegate',
      'class ReactNativeDelegate: OtaKitExpoFixtureDelegate',
    );
    return config;
  });
  config = withPodfile(config, (config) => {
    config.modResults.contents = replaceOnce(
      config.modResults.contents,
      '  use_expo_modules!',
      `  use_expo_modules!
  require Pod::Executable.execute_command('node', ['-p', 'require.resolve("@otakit/react-native-updater/scripts/cocoapods.rb", {paths: [process.argv[1]]})', __dir__]).strip
  use_otakit_updater!`,
    );
    return config;
  });
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const name = 'Stage OtaKit Expo fixture';
    const phases = Object.values(project.hash.project.objects.PBXShellScriptBuildPhase ?? {});
    const matching = phases.filter((phase) => phase?.name === `"${name}"`);
    if (matching.length > 1) throw new Error('Duplicate Expo fixture resource phases');
    const script = '/bin/sh "$PROJECT_DIR/../ios-fixture.sh"\n';
    if (matching.length) matching[0].shellScript = JSON.stringify(script);
    else {
      project.addBuildPhase([], 'PBXShellScriptBuildPhase', name, project.getFirstTarget().uuid, {
        shellPath: '/bin/sh',
        shellScript: script,
      });
    }
    return config;
  });
};
