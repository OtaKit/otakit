import { describe, expect, it } from 'vitest';
import { selectIOSSettings } from './ios-build.js';

const settings = {
  PRODUCT_TYPE: 'com.apple.product-type.application',
  PLATFORM_NAME: 'iphonesimulator',
  USE_HERMES: 'true',
  ENABLE_TESTABILITY: 'NO',
  CONFIGURATION: 'Release',
  TARGET_NAME: 'Example',
  TARGET_BUILD_DIR: '/tmp/products',
  PROJECT_FILE_PATH: '/tmp/project/ios/Example.xcodeproj',
  PROJECT_DIR: '/tmp/project/ios',
  PODS_ROOT: '/tmp/project/ios/Pods',
  PRODUCT_BUNDLE_IDENTIFIER: 'test.example',
  FULL_PRODUCT_NAME: 'Example.app',
  UNLOCALIZED_RESOURCES_FOLDER_PATH: 'Example.app',
};

describe('Xcode application selection', () => {
  it('selects a named app without treating dependencies or another app as its build', () => {
    const targets = [
      { buildSettings: { PRODUCT_TYPE: 'com.apple.product-type.library.static' } },
      { buildSettings: settings },
      { buildSettings: { ...settings, TARGET_NAME: 'Companion' } },
    ];
    expect(() => selectIOSSettings(targets)).toThrow('exactly one');
    expect(selectIOSSettings(targets, 'Example')).toEqual(settings);
    expect(() => selectIOSSettings(targets, 'Missing')).toThrow('exactly one');
  });

  it.each([
    { CONFIGURATION: 'Debug' },
    { ENABLE_TESTABILITY: 'YES' },
    { USE_HERMES: 'false' },
    { PLATFORM_NAME: 'macosx' },
    { IS_MACCATALYST: 'YES' },
    { SKIP_BUNDLING: '1' },
    { BUNDLE_COMMAND: 'export:embed' },
    { EXTRA_PACKAGER_ARGS: '--dev true' },
    { HERMES_FLAGS: '-O0' },
    { FULL_PRODUCT_NAME: '../Other.app' },
    { UNLOCALIZED_RESOURCES_FOLDER_PATH: 'Example.app/Contents/Resources' },
  ])('rejects unsupported native/bundler settings: %j', (override) => {
    expect(() => selectIOSSettings([{ buildSettings: { ...settings, ...override } }])).toThrow();
  });
});
