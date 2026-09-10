// Research probes, not an updater implementation or native integration suite.
// Run from the repository: node research/react-native-ota/verify-integration.mjs
// Uses the repository's TypeScript compiler, Node >= 22, tar, and network access.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const inventory = JSON.parse(
  await readFile(new URL('./integration-sources.json', import.meta.url)),
);
const sources = new Map();
let checks = 0;
let hashedFiles = 0;
function check(label, run) {
  run();
  checks++;
  console.log(`PASS ${label}`);
}
async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, url);
  return Buffer.from(await response.arrayBuffer());
}
function record(key, bytes, expectedHash) {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, key);
  sources.set(key, bytes.toString('utf8'));
  hashedFiles++;
}
// Read members directly from verified tarballs; never install dependencies or run lifecycle scripts.
for (const pkg of inventory.packages) {
  const tarball = await fetchBytes(pkg.tarball);
  assert.equal(`sha512-${createHash('sha512').update(tarball).digest('base64')}`, pkg.integrity);
  for (const file of pkg.files) {
    const bytes = execFileSync('tar', ['-xOzf', '-', `package/${file.path}`], {
      input: tarball,
      maxBuffer: 8 * 1024 * 1024,
    });
    record(`${pkg.name}/${file.path}`, bytes, file.sha256);
  }
}
for (const rn of inventory.reactNative) {
  for (const file of rn.files) {
    record(`rn-${rn.version}/${file.path}`, await fetchBytes(file.url), file.sha256);
  }
}
console.log(
  `Verified ${inventory.packages.length} npm tarball integrities and ${hashedFiles} source hashes.`,
);

function source(key) {
  assert.ok(sources.has(key), `Missing pinned source: ${key}`);
  return sources.get(key);
}
function has(key, ...patterns) {
  for (const pattern of patterns) assert.match(source(key), pattern, key);
}

// Textual contracts corroborate manual source reading; they do not execute native code.
for (const { version } of inventory.reactNative) {
  const root = `rn-${version}/`;
  check(
    `RN ${version}: iOS command reload restarts surfaces and rereads bundle provider (source)`,
    () => {
      has(
        `${root}ReactCommon/react/runtime/platform/ios/ReactCommon/RCTHost.mm`,
        /didReceiveReloadCommand[^}]+_reloadWithShouldRestartSurfaces:YES/s,
        /- \(void\)reload\s*\{[^}]+_reloadWithShouldRestartSurfaces:NO/s,
        /_reloadWithShouldRestartSurfaces:\(BOOL\)shouldRestartSurfaces\s*\{[\s\S]*?_setBundleURL:_bundleURLProvider\(\)/,
        /RCTRegisterReloadCommandListener\(self\)/,
      );
      has(
        `${root}React/Base/RCTReloadCommand.m`,
        /void RCTTriggerReloadCommandListeners/,
        /didReceiveReloadCommand/,
      );
    },
  );
  check(`RN ${version}: Android reload reads delegate loader (source)`, () => {
    has(
      `${root}ReactAndroid/src/main/java/com/facebook/react/runtime/ReactHostImpl.kt`,
      /private val jsBundleLoader: Task<JSBundleLoader>/,
      /Task\.forResult\(reactHostDelegate\.jsBundleLoader\)/,
    );
  });
  check(
    `RN ${version}: headless service starts host without UI; listener replays active tasks (source)`,
    () => {
      has(
        `${root}ReactAndroid/src/main/java/com/facebook/react/HeadlessJsTaskService.kt`,
        /reactHost\.start\(\)/,
      );
      has(
        `${root}ReactAndroid/src/main/java/com/facebook/react/jstasks/HeadlessJsTaskContext.kt`,
        /fun addTaskEventListener[^}]+for \(activeTaskId in activeTasks\)[^}]+onHeadlessJsTaskStart/s,
        /fun hasActiveTasks\(\): Boolean = activeTasks\.isNotEmpty\(\)/,
        /fun removeTaskEventListener/,
      );
    },
  );
}
check('Published Expo SDK pins RN 0.86.3 and the inspected asset/Constants/DOM versions', () => {
  const modules = JSON.parse(source('expo/bundledNativeModules.json'));
  assert.equal(modules['react-native'], '0.86.3');
  assert.equal(modules['expo-constants'], '~57.0.15');
  assert.equal(modules['expo-asset'], '~57.0.15');
  assert.equal(modules['@expo/dom-webview'], '~57.0.1');
});
check('Expo iOS uses reload command on main queue and a dynamic factory URL (source)', () => {
  has(
    'expo-updates/ios/EXUpdates/Procedures/RecreateReactContextProcedure.swift',
    /DispatchQueue\.main\.async/,
    /RCTTriggerReloadCommandListeners\(self\.triggerReloadCommandListenersReason\)/,
  );
  has('expo/ios/AppDelegates/ExpoReactNativeFactory.swift', /weakDelegate\?\.bundleURL\(\)/);
  has(
    'expo-updates/ios/EXUpdates/ReactDelegateHandler/ExpoUpdatesReactDelegateHandler.swift',
    /recreateRootView/,
    /initialProps/,
    /launchOptions/,
  );
});
check('Expo Android dynamic loader and Activity preparation gate (source)', () => {
  has(
    'expo/android/src/main/java/expo/modules/ExpoReactHostFactory.kt',
    /val hostDelegateJsBundleFilePath: String\?\s+get\(\)/,
    /it\.getJSBundleFile\(useDevSupport\)/,
    /override val jsBundleLoader: JSBundleLoader\s+get\(\)/,
  );
  has(
    'expo-updates/android/src/main/java/expo/modules/updates/UpdatesPackage.kt',
    /ReactActivityHandler\.DelayLoadAppHandler/,
    /Dispatchers\.IO/,
    /Dispatchers\.Main/,
    /whenReadyRunnable\.run\(\)/,
  );
});
check('Expo DOM WebViews accept local files on both platforms (source)', () => {
  has('@expo/dom-webview/ios/DomWebView.swift', /loadFileURL\(url, allowingReadAccessTo:/);
  has(
    '@expo/dom-webview/android/src/main/java/expo/modules/webview/DomWebView.kt',
    /settings\.allowFileAccess = true/,
    /settings\.allowFileAccessFromFileURLs = true/,
  );
  has('expo/src/dom/webview-wrapper.tsx', /getBaseURL\(\).*filePath/);
});
check('Expo embed export defaults to JS and exports DOM component HTML (source)', () => {
  has(
    '@expo/cli/build/src/export/embed/exportEmbedAsync.js',
    /bytecode: options\.bytecode \?\? false/,
    /copyPublicFolderAsync/,
  );
  has(
    '@expo/cli/build/src/export/exportDomComponents.js',
    /DOM_COMPONENTS_BUNDLE_DIR/,
    /\.html/,
    /baseUrl: '\.\/'/,
  );
});
check('expo-asset native resolution delegates to RN (source)', () => {
  has(
    'expo-asset/src/resolveAssetSource.native.ts',
    /react-native\/Libraries\/Image\/resolveAssetSource/,
  );
  has('expo-asset/src/PlatformUtils.ts', /isEnabled/, /isUsingEmbeddedAssets/);
});
check('Published fingerprint collection can swallow source errors (source)', () => {
  has('@expo/fingerprint/build/sourcer/Expo.js', /catch\s*\{\s*return \[\];/);
  has(
    '@expo/fingerprint/build/sourcer/Bare.js',
    /Error adding react-native core autolinking sources/,
  );
});

function evaluateTS(key, env, dependencies = {}, globals = {}) {
  const exports = {};
  const output = ts.transpileModule(source(key), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(
    output,
    {
      exports,
      process: { env },
      URL,
      ...globals,
      require(id) {
        assert.ok(Object.hasOwn(dependencies, id), `Unexpected import ${id} in ${key}`);
        return dependencies[id];
      },
    },
    { filename: key, timeout: 1000 },
  );
  return exports;
}
function dom(os, { updates, development = false } = {}) {
  return evaluateTS(
    'expo/src/dom/base.ts',
    {
      EXPO_OS: os,
      NODE_ENV: development ? 'development' : 'production',
      EXPO_BASE_URL: '/web-base',
    },
    {
      'react-native/Libraries/Core/Devtools/getDevServer': {
        default: () => ({ url: 'http://localhost:8081' }),
      },
    },
    { expo: { modules: updates ? { ExpoUpdates: updates } : {} } },
  );
}
const embeddedConfig = {
  name: 'Fixture',
  slug: 'fixture',
  extra: { apiUrl: 'https://embedded.example' },
};
function constants(os, updates = null, config = embeddedConfig) {
  const types = {
    ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
    AppOwnership: { Standalone: 'standalone' },
    UserInterfaceIdiom: { Phone: 'phone' },
  };
  return evaluateTS(
    'expo-constants/src/Constants.ts',
    {},
    {
      'expo-modules-core': { CodedError: Error, requireOptionalNativeModule: () => updates },
      'react-native': { Platform: { OS: os }, NativeModules: {} },
      './Constants.types': types,
      './ExponentConstants': {
        __esModule: true,
        default: {
          manifest: os === 'android' ? JSON.stringify(config) : config,
          executionEnvironment: 'standalone',
          nativeBuildVersion: '42',
        },
      },
    },
  );
}
for (const os of ['ios', 'android']) {
  check(`Execute Expo ${os}: no Updates module resolves DOM/config to embedded content`, () => {
    assert.equal(
      dom(os).getBaseURL(),
      os === 'ios' ? 'www.bundle' : 'file:///android_asset/www.bundle',
    );
    assert.deepEqual(JSON.parse(JSON.stringify(constants(os).default.expoConfig)), embeddedConfig);
  });
  check(`Execute Expo ${os}: enabled Updates supplies DOM base and update config`, () => {
    const config = { ...embeddedConfig, extra: { apiUrl: 'https://expo-update.example' } };
    const updates = {
      isEnabled: true,
      isEmbeddedLaunch: false,
      localAssets: { logo: 'file:///private/update/logo.png' },
      manifest: { metadata: {}, extra: { expoClient: config } },
    };
    assert.equal(dom(os, { updates }).getBaseURL(), 'file:///private/update');
    assert.deepEqual(constants(os, updates).default.expoConfig, config);
  });
  check(`Execute Expo ${os}: native development still resolves DOM to Metro`, () => {
    assert.equal(dom(os, { development: true }).getBaseURL(), 'http://localhost:8081/_expo/@dom');
  });
}
check('Execute Expo: web base is preserved', () =>
  assert.equal(dom('web').getBaseURL(), '/web-base'),
);
check('Execute Expo: disabling Updates alone can leave its manifest in Constants', () => {
  const config = { extra: { retainedManifest: true } };
  assert.equal(
    constants('ios', {
      isEnabled: false,
      manifest: { metadata: {}, extra: { expoClient: config } },
    }).default.expoConfig,
    config,
  );
});

// Minimal executable DESIGN prototypes. They do not implement Metro interception,
// native LaunchContext binding, verification, installation, or lifecycle handling.
function deepFreeze(value) {
  for (const child of Object.values(value))
    if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}
function launchContext(kind, version, config) {
  return deepFreeze(
    structuredClone({
      kind,
      version,
      publicExpoConfig: config,
      domRootUri:
        kind === 'downloaded'
          ? pathToFileURL(`/private/OtaKit updates/${version}/www.bundle`).href
          : null,
    }),
  );
}
function adapters(originalConstants, originalDOM, context) {
  const descriptors = Object.getOwnPropertyDescriptors(originalConstants.default);
  descriptors.expoConfig = {
    ...descriptors.expoConfig,
    get: () =>
      context.kind === 'downloaded'
        ? context.publicExpoConfig
        : originalConstants.default.expoConfig,
  };
  const facade = Object.defineProperties(
    Object.create(Object.getPrototypeOf(originalConstants.default)),
    descriptors,
  );
  return {
    constants: { ...originalConstants, default: facade },
    getBaseURL: () =>
      context.kind === 'downloaded' ? context.domRootUri : originalDOM.getBaseURL(),
  };
}
const original = constants('ios');
const nextConfig = { ...embeddedConfig, extra: { apiUrl: 'https://ota.example' } };
const firstContext = launchContext('downloaded', 'a', nextConfig);
const first = adapters(original, dom('ios'), firstContext);
check(
  'Adapter prototype: new Constants facade works without mutating non-configurable original',
  () => {
    assert.equal(
      Object.getOwnPropertyDescriptor(original.default, 'expoConfig').configurable,
      false,
    );
    assert.throws(
      () => Object.defineProperty(original.default, 'expoConfig', { get: () => nextConfig }),
      TypeError,
    );
    assert.deepEqual(first.constants.default.expoConfig, nextConfig);
    assert.deepEqual(original.default.expoConfig, embeddedConfig);
    assert.equal(first.constants.default.nativeBuildVersion, '42');
    assert.equal(first.constants.default.manifest, original.default.manifest);
    assert.equal(first.constants.ExecutionEnvironment, original.ExecutionEnvironment);
  },
);
check('Adapter prototype: encoded file URI preserves the DOM component filename', () => {
  assert.equal(
    `${first.getBaseURL()}/component.html`,
    'file:///private/OtaKit%20updates/a/www.bundle/component.html',
  );
});
check('Adapter prototype: preparing a new selection cannot change an old instance', () => {
  const secondContext = launchContext('downloaded', 'b', {
    ...nextConfig,
    extra: { apiUrl: 'https://next.example' },
  });
  const second = adapters(original, dom('ios'), secondContext);
  assert.equal(first.constants.default.expoConfig.extra.apiUrl, 'https://ota.example');
  assert.equal(second.constants.default.expoConfig.extra.apiUrl, 'https://next.example');
  assert.notEqual(first.getBaseURL(), second.getBaseURL());
  assert.throws(() => {
    firstContext.publicExpoConfig.extra.apiUrl = 'changed';
  }, TypeError);
});
check('Adapter prototype: rollback restores the previous config and DOM root together', () => {
  const rollback = adapters(original, dom('ios'), firstContext);
  assert.equal(rollback.getBaseURL(), first.getBaseURL());
  assert.equal(rollback.constants.default.expoConfig, first.constants.default.expoConfig);
  const builtin = adapters(
    original,
    dom('ios'),
    launchContext('embedded', 'builtin', embeddedConfig),
  );
  assert.equal(builtin.getBaseURL(), 'www.bundle');
  assert.equal(builtin.constants.default.expoConfig, original.default.expoConfig);
});
console.log(
  `\n${checks} checks passed. Native compilation, Metro integration, and device lifecycle/WebView tests remain required.`,
);
