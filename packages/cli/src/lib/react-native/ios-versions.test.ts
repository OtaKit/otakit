import { expect, it } from 'vitest';
import { resolveIOSVersions } from './ios-versions.js';

const settings = { MARKETING_VERSION: '1.0', CURRENT_PROJECT_VERSION: '7' };

it('uses Expo literal plist versions even when Xcode has a different default', () => {
  const plist = { CFBundleVersion: '1', CFBundleShortVersionString: '1.0.0' };
  expect(resolveIOSVersions(plist, settings)).toEqual(plist);
});

it('resolves the ordinary React Native version build settings', () => {
  expect(
    resolveIOSVersions(
      {
        CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
        CFBundleShortVersionString: '${MARKETING_VERSION}',
      },
      settings,
    ),
  ).toEqual({ CFBundleVersion: '7', CFBundleShortVersionString: '1.0' });
});

it.each(['$(MISSING)', '$(MARKETING_VERSION:unsupported)', '$UNKNOWN', ''])(
  'refuses to guess an unresolved version: %s',
  (value) => {
    expect(() =>
      resolveIOSVersions({ CFBundleVersion: '1', CFBundleShortVersionString: value }, settings),
    ).toThrow();
  },
);

it.each([
  { INFOPLIST_PREPROCESS: 'YES' },
  { INFOPLIST_KEY_CFBundleVersion: '10' },
  { INFOPLIST_EXPAND_BUILD_SETTINGS: 'NO' },
])('rejects version transformations it cannot bind: %j', (override) => {
  expect(() =>
    resolveIOSVersions(
      {
        CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
        CFBundleShortVersionString: '1.0',
      },
      { ...settings, ...override },
    ),
  ).toThrow();
});
