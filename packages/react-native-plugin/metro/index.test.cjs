const assert = require('node:assert/strict');
const test = require('node:test');
const { withOtaKitMetro } = require('./index.cjs');

test('disabled integration leaves the development host and Expo modules untouched', () => {
  const original = {
    serializer: { getModulesRunBeforeMainModule: () => ['expo-development-entry'] },
    resolver: { resolveRequest: () => ({ type: 'sourceFile', filePath: '/expo/constants.js' }) },
  };
  assert.equal(withOtaKitMetro(original, { enabled: false }), original);
});

test('preserves existing Metro initialization and resolver behavior', () => {
  const calls = [];
  const original = {
    serializer: {
      customSerializer: 'owned-by-host',
      getModulesRunBeforeMainModule: (entry) => ['polyfill', entry],
    },
    resolver: {
      resolveRequest: (context, name, platform) => {
        calls.push([context.originModulePath, name, platform]);
        return { type: 'sourceFile', filePath: `/modules/${name}.js` };
      },
    },
  };
  const config = withOtaKitMetro(original);
  const modules = config.serializer.getModulesRunBeforeMainModule('app-main');
  assert.deepEqual(modules.slice(0, 2), ['polyfill', 'app-main']);
  assert.match(modules[2], /src\/bootstrap\.ts$/);
  assert.equal(config.serializer.customSerializer, 'owned-by-host');
  assert.deepEqual(
    config.resolver.resolveRequest({ originModulePath: '/app.js' }, 'other', 'android'),
    { type: 'sourceFile', filePath: '/modules/other.js' },
  );
  assert.deepEqual(calls, [['/app.js', 'other', 'android']]);
  assert.equal(original.serializer.getModulesRunBeforeMainModule('app-main').length, 2);
});

test('Expo facades retain the resolved originals, including relative DOM imports', () => {
  const originals = {
    'expo-constants': '/modules/expo-constants/build/Constants.js',
    './base': '/modules/expo/src/dom/base.ts',
  };
  const config = withOtaKitMetro({});
  const context = {
    originModulePath: '/app.js',
    resolveRequest: (_context, name) => {
      if (!originals[name]) throw new Error(`Unexpected package-subpath lookup: ${name}`);
      return { type: 'sourceFile', filePath: originals[name] };
    },
  };
  assert.match(
    config.resolver.resolveRequest(context, 'expo-constants', 'ios').filePath,
    /src\/expo\/constants\.ts$/,
  );
  assert.match(
    config.resolver.resolveRequest(context, './base', 'ios').filePath,
    /src\/expo\/dom\.ts$/,
  );
  assert.equal(
    config.resolver.resolveRequest(context, 'otakit:original-expo-constants', 'ios').filePath,
    originals['expo-constants'],
  );
  assert.equal(
    config.resolver.resolveRequest(context, 'otakit:original-expo-dom', 'ios').filePath,
    originals['./base'],
  );
  assert.throws(
    () => config.resolver.resolveRequest(context, 'otakit:original-expo-dom', 'android'),
    /without its original/,
  );
});

test('Expo DOM web bundles preserve their initializer and module implementations', () => {
  const config = withOtaKitMetro({
    serializer: { getModulesRunBeforeMainModule: () => ['expo-web-polyfill'] },
  });
  assert.deepEqual(config.serializer.getModulesRunBeforeMainModule('/modules/expo/dom/entry.js'), [
    'expo-web-polyfill',
  ]);
  const original = { type: 'sourceFile', filePath: '/modules/expo-constants/build/Constants.js' };
  assert.equal(
    config.resolver.resolveRequest({ resolveRequest: () => original }, 'expo-constants', 'web'),
    original,
  );
});
