import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertDescriptor, canonicalJSON } from '@otakit/rn-protocol';
import { hashFile } from '../hash.js';
import {
  assertSameNativeBuild,
  captureNativeBuild,
  type NativeBuildInputs,
  type NativeBuildRecord,
} from './build-record.js';
import { assertOutputOutside, sealNativeBuild } from './completed-build.js';
import { exportRN } from './export.js';
import { prepareExpoEnvironment } from './expo-environment.js';
import { stageEmbedded } from './stage-embedded.js';
import { withReceiptLock, writeReceipt } from './receipts.js';
import { readIOSVersions, type IOSVersions } from './ios-versions.js';

type Settings = Record<string, string>;
const application = 'com.apple.product-type.application';
// Evaluated settings supplement source/configuration hashes. Build output paths do not
// belong in the runtime identity; the request separately binds the exact product path.
const recordedSettings = [
  'TARGET_NAME',
  'CONFIGURATION',
  'PLATFORM_NAME',
  'PRODUCT_BUNDLE_IDENTIFIER',
  'CURRENT_PROJECT_VERSION',
  'MARKETING_VERSION',
  'SDK_VERSION',
  'XCODE_VERSION_ACTUAL',
  'ARCHS',
  'IPHONEOS_DEPLOYMENT_TARGET',
  'SWIFT_VERSION',
  'SWIFT_OPTIMIZATION_LEVEL',
  'SWIFT_ACTIVE_COMPILATION_CONDITIONS',
  'GCC_PREPROCESSOR_DEFINITIONS',
  'OTHER_CFLAGS',
  'OTHER_CPLUSPLUSFLAGS',
  'OTHER_SWIFT_FLAGS',
  'OTHER_LDFLAGS',
  'CLANG_CXX_LANGUAGE_STANDARD',
  'ENABLE_BITCODE',
  'USE_HERMES',
  'RCT_NEW_ARCH_ENABLED',
  'ENABLE_TESTABILITY',
  'GCC_OPTIMIZATION_LEVEL',
  'DEAD_CODE_STRIPPING',
] as const;
const unsupportedSettings = [
  'SKIP_BUNDLING',
  'BUNDLE_CONFIG',
  'CLI_PATH',
  'NODE_ARGS',
  'EXTRA_PACKAGER_ARGS',
  'HERMES_FLAGS',
  'BUNDLE_NAME',
  'SOURCEMAP_FILE',
];

export function selectIOSSettings(value: unknown, target?: string): Settings {
  if (!Array.isArray(value)) throw new Error('Invalid Xcode build settings response');
  const apps = value
    .map((item) => item?.buildSettings as Settings | undefined)
    .filter((item): item is Settings =>
      Boolean(
        item && item.PRODUCT_TYPE === application && (!target || item.TARGET_NAME === target),
      ),
    );
  if (apps.length !== 1) throw new Error('Select exactly one iOS application with --app-target');
  validateSettings(apps[0]);
  return apps[0];
}

function validateSettings(settings: Settings): void {
  if (
    settings.PRODUCT_TYPE !== application ||
    !['iphoneos', 'iphonesimulator'].includes(settings.PLATFORM_NAME) ||
    settings.IS_MACCATALYST === 'YES' ||
    settings.USE_HERMES !== 'true' ||
    settings.ENABLE_TESTABILITY === 'YES' ||
    /debug/i.test(settings.CONFIGURATION)
  )
    throw new Error('OtaKit iOS builds require a non-Debug Hermes iOS application');
  for (const key of unsupportedSettings) {
    if (settings[key]) throw new Error(`OtaKit iOS builds do not support ${key}`);
  }
  if (settings.BUNDLE_COMMAND && settings.BUNDLE_COMMAND !== 'bundle')
    throw new Error('OtaKit iOS builds require the standard React Native bundle command');
  for (const key of [
    'TARGET_NAME',
    'CONFIGURATION',
    'TARGET_BUILD_DIR',
    'PROJECT_FILE_PATH',
    'PROJECT_DIR',
    'PODS_ROOT',
    'PRODUCT_BUNDLE_IDENTIFIER',
    'FULL_PRODUCT_NAME',
  ])
    if (!settings[key]) throw new Error(`Missing Xcode build setting ${key}`);
  if (
    basename(settings.FULL_PRODUCT_NAME) !== settings.FULL_PRODUCT_NAME ||
    !settings.FULL_PRODUCT_NAME.endsWith('.app') ||
    settings.UNLOCALIZED_RESOURCES_FOLDER_PATH !== settings.FULL_PRODUCT_NAME
  )
    throw new Error('Unsupported iOS application resource layout');
}

function identitySettings(settings: Settings, versions: IOSVersions): Record<string, unknown> {
  return {
    format: 'otakit-rn-xcode-build',
    version: 2,
    bundleVersions: versions,
    ...Object.fromEntries(recordedSettings.map((key) => [key, settings[key] ?? ''])),
  };
}

type BuildRequest = {
  format: 'otakit-rn-xcode-request';
  version: 1;
  runId: string;
  project: string;
  entry: string;
  embeddedVersion: string;
  settings: Settings;
  nativeInputs: NativeBuildInputs;
  nativeBuild: NativeBuildRecord;
};

export type IOSBuildOptions = {
  project: string;
  workspace: string;
  scheme: string;
  configuration: string;
  sdk?: string;
  destination?: string;
  derivedData: string;
  appTarget?: string;
  nativeInputs: string;
  version: string;
  output: string;
  entry?: string;
  codeSigning?: boolean;
  cli: string;
};

async function configurationFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) result.push(...(await configurationFiles(path)));
    else if (item.isFile()) result.push(path);
    else throw new Error(`Unexpected symlink or special file in CocoaPods configuration: ${path}`);
  }
  return result;
}

async function runXcode(
  args: string[],
  project: string,
  env: NodeJS.ProcessEnv,
  log: string,
): Promise<void> {
  const file = await open(log, 'wx', 0o600);
  try {
    await new Promise<void>((accept, reject) => {
      const child = spawn('xcodebuild', args, {
        cwd: project,
        env,
        stdio: ['ignore', file.fd, file.fd],
      });
      child.once('error', reject);
      child.once('close', (code, signal) =>
        code === 0
          ? accept()
          : reject(new Error(`Xcode build failed (${signal ?? code}); see ${log}`)),
      );
    });
  } finally {
    await file.close();
  }
}

/** Sealing runs only after xcodebuild returns success, including its signing phases. */
export async function buildIOS(options: IOSBuildOptions) {
  const project = await realpath(resolve(options.project));
  prepareExpoEnvironment(project);
  const output = resolve(options.output);
  await assertOutputOutside(project, output);
  const workspace = await realpath(resolve(project, options.workspace));
  const derivedData = resolve(options.derivedData);
  await assertOutputOutside(derivedData, output);
  await assertOutputOutside(output, derivedData);
  const args = [
    '-workspace',
    workspace,
    '-scheme',
    options.scheme,
    '-configuration',
    options.configuration,
    '-derivedDataPath',
    derivedData,
  ];
  if (options.sdk) args.push('-sdk', options.sdk);
  if (options.destination) args.push('-destination', options.destination);
  if (options.codeSigning === false) args.push('CODE_SIGNING_ALLOWED=NO');
  const env = { ...process.env, NODE_PATH: '' };
  const response = await promisify(execFile)(
    'xcodebuild',
    [...args, '-showBuildSettings', '-json'],
    {
      cwd: project,
      env,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const settings = selectIOSSettings(JSON.parse(response.stdout), options.appTarget);
  validateSettings({ ...env, ...settings });
  const productPath = join(settings.TARGET_BUILD_DIR, settings.FULL_PRODUCT_NAME);
  await assertOutputOutside(productPath, output);
  await assertOutputOutside(output, productPath);
  const inputs = JSON.parse(
    await readFile(resolve(options.nativeInputs), 'utf8'),
  ) as NativeBuildInputs;
  if (
    inputs.platform !== 'ios' ||
    inputs.variant !== settings.CONFIGURATION ||
    inputs.nativeApplicationId !== settings.PRODUCT_BUNDLE_IDENTIFIER
  )
    throw new Error('Native inputs do not match the selected Xcode application/configuration');
  const resource = inputs.nativeConfiguration.otakitResourceDirectory;
  if (
    typeof resource !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(resource) ||
    typeof inputs.nativeConfiguration.otakitHostConfigurationFile !== 'string'
  )
    throw new Error(
      'Record otakitResourceDirectory and otakitHostConfigurationFile before building',
    );
  const hook = await realpath(
    createRequire(join(project, 'package.json')).resolve(
      '@otakit/react-native-updater/scripts/xcode.sh',
    ),
  );
  const rnDirectory = dirname(
    createRequire(join(project, 'package.json')).resolve('react-native/package.json'),
  );
  if (
    !settings.REACT_NATIVE_PATH ||
    (await realpath(settings.REACT_NATIVE_PATH)) !== (await realpath(rnDirectory))
  )
    throw new Error('Xcode must use the React Native installation selected by the project');
  const lock = await readFile(join(settings.PROJECT_DIR, 'Podfile.lock'));
  if (!lock.equals(await readFile(join(settings.PODS_ROOT, 'Manifest.lock'))))
    throw new Error('CocoaPods lockfiles differ; run pod install before building');
  const plist = await readIOSVersions(settings);
  const nativeFiles = [
    ...inputs.nativeFiles,
    plist.file,
    hook,
    join(rnDirectory, 'scripts/xcode/with-environment.sh'),
    join(settings.PROJECT_FILE_PATH, 'project.pbxproj'),
    join(workspace, 'contents.xcworkspacedata'),
    join(settings.PROJECT_DIR, 'Podfile'),
    join(settings.PROJECT_DIR, 'Podfile.lock'),
    join(settings.PODS_ROOT, 'Manifest.lock'),
    ...(await configurationFiles(join(settings.PODS_ROOT, 'Target Support Files'))),
    ...(await configurationFiles(join(settings.PODS_ROOT, 'Local Podspecs'))),
  ];
  const xcodeEnv = join(settings.PROJECT_DIR, '.xcode.env');
  if (
    await lstat(xcodeEnv).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    })
  )
    nativeFiles.push(xcodeEnv);
  const nativeInputs: NativeBuildInputs = {
    ...inputs,
    nativeFiles: [...new Set(nativeFiles)],
    nativeConfiguration: {
      ...inputs.nativeConfiguration,
      iosBuild: identitySettings(settings, plist.versions),
    },
  };
  const compiler =
    settings.HERMES_CLI_PATH || join(settings.PODS_ROOT, 'hermes-engine/destroot/bin/hermesc');
  if ((await hashFile(compiler)) !== (await hashFile(resolve(project, inputs.hermesCompiler))))
    throw new Error('Xcode Hermes compiler differs from the selected native inputs');
  nativeInputs.hermesCompiler = compiler;
  const iosEntry = join(project, 'index.ios.js');
  const entry =
    options.entry ||
    settings.ENTRY_FILE ||
    process.env.ENTRY_FILE ||
    ((await lstat(iosEntry).catch(() => null))?.size ? 'index.ios.js' : 'index.js');
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { mode: 0o700 }); // An interrupted or previous build is never reused.
  return withReceiptLock(join(derivedData, 'otakit-build'), async () => {
    const request: BuildRequest = {
      format: 'otakit-rn-xcode-request',
      version: 1,
      runId: randomUUID(),
      project,
      entry,
      embeddedVersion: options.version,
      settings,
      nativeInputs,
      nativeBuild: await captureNativeBuild(project, nativeInputs),
    };
    // Store only settings needed to bind the phase, not Xcode's entire environment.
    request.settings = Object.fromEntries(
      [
        ...new Set([
          ...recordedSettings,
          'PRODUCT_TYPE',
          'PROJECT_FILE_PATH',
          'PROJECT_DIR',
          'PODS_ROOT',
          'TARGET_BUILD_DIR',
          'FULL_PRODUCT_NAME',
          'UNLOCALIZED_RESOURCES_FOLDER_PATH',
          'HERMES_CLI_PATH',
          'REACT_NATIVE_PATH',
          'PODFILE_DIR',
        ]),
      ].map((key) => [key, settings[key] ?? '']),
    );
    await writeReceipt(join(output, 'request.json'), request);
    await writeReceipt(join(output, 'native-inputs.json'), nativeInputs);
    await runXcode(
      [
        ...args,
        `OTAKIT_BUILD_REQUEST=${join(output, 'request.json')}`,
        `OTAKIT_NODE_BINARY=${process.execPath}`,
        `OTAKIT_CLI=${await realpath(options.cli)}`,
        `OTAKIT_XCODE_HOOK=${hook}`,
        `OTAKIT_XCODE_TARGET=${settings.TARGET_NAME}`,
        'build',
      ],
      project,
      env,
      join(output, 'build.log'),
    );
    const phase = JSON.parse(
      await readFile(join(output, 'phase.json'), 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT')
          throw new Error('The OtaKit Xcode phase did not run for this invocation');
        throw error;
      }),
    );
    if (
      phase.runId !== request.runId ||
      phase.runtimeVersion !== request.nativeBuild.runtimeVersion
    )
      throw new Error('Missing or stale OtaKit Xcode phase receipt');
    const binary = join(output, settings.FULL_PRODUCT_NAME);
    await cp(productPath, binary, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const embeddedExport = join(output, 'export', `ios-${request.nativeBuild.runtimeVersion}`);
    const receiptPath = join(output, 'completed-build.json');
    await sealNativeBuild({ project, nativeInputs, embeddedExport, binary, receiptPath });
    return {
      receiptPath,
      binary,
      embeddedExport,
      nativeInputs: join(output, 'native-inputs.json'),
    };
  });
}

/** Invoked by the installed hook, inside the app's existing RN bundle phase. */
export async function stageIOSBuild(requestPath: string, env = process.env): Promise<void> {
  const path = await realpath(requestPath);
  const output = dirname(path);
  const request = JSON.parse(await readFile(path, 'utf8')) as BuildRequest;
  if (
    basename(path) !== 'request.json' ||
    request.format !== 'otakit-rn-xcode-request' ||
    request.version !== 1 ||
    !request.runId
  )
    throw new Error('Invalid OtaKit Xcode build request');
  const settings = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  validateSettings(settings);
  if (
    settings.ENTRY_FILE &&
    resolve(request.project, settings.ENTRY_FILE) !== resolve(request.project, request.entry)
  )
    throw new Error(
      'Xcode ENTRY_FILE differs from preflight; pass the matching --entry to build-ios',
    );
  if (settings.PROJECT_ROOT && (await realpath(settings.PROJECT_ROOT)) !== request.project)
    throw new Error('Xcode PROJECT_ROOT differs from the selected React Native project');
  for (const [key, value] of Object.entries(request.settings)) {
    if ((settings[key] ?? '') !== value)
      throw new Error(`Xcode build setting changed after preflight: ${key}`);
  }
  if (
    canonicalJSON(identitySettings(settings, (await readIOSVersions(settings)).versions)) !==
    canonicalJSON(request.nativeInputs.nativeConfiguration.iosBuild)
  )
    throw new Error('Xcode request differs from recorded native configuration');
  assertSameNativeBuild(
    request.nativeBuild,
    await captureNativeBuild(request.project, request.nativeInputs),
  );
  await exportRN({
    project: request.project,
    entry: request.entry,
    version: request.embeddedVersion,
    output: join(output, 'export'),
    nativeInputs: request.nativeInputs,
    nativeBuild: request.nativeBuild,
    purpose: 'embedded',
  });
  const resource = request.nativeInputs.nativeConfiguration.otakitResourceDirectory as string;
  const staged = join(output, 'resources', resource);
  await stageEmbedded({
    embeddedExport: join(output, 'export', `ios-${request.nativeBuild.runtimeVersion}`),
    configuration: resolve(
      request.project,
      request.nativeInputs.nativeConfiguration.otakitHostConfigurationFile as string,
    ),
    output: staged,
  });
  const product = await realpath(join(settings.TARGET_BUILD_DIR, settings.FULL_PRODUCT_NAME));
  const destination = join(product, resource);
  const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
    throw new Error('Unsafe existing OtaKit resource destination');
  if (
    existing &&
    (await readdir(destination)).some(
      (name) =>
        !['payload', 'configuration.json', 'otakit-embedded.json', 'case-folding.json'].includes(
          name,
        ),
    )
  )
    throw new Error('Existing resource destination contains files not owned by OtaKit');
  const descriptor = JSON.parse(await readFile(join(staged, 'payload/otakit-bundle.json'), 'utf8'));
  assertDescriptor(descriptor);
  const domDestination = join(product, 'www.bundle');
  if (descriptor.expo) {
    const existingDOM = await lstat(domDestination).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (existingDOM && (!existingDOM.isDirectory() || existingDOM.isSymbolicLink()))
      throw new Error('Unsafe existing Expo DOM resource destination');
  }
  const temporary = join(product, `.otakit-${request.runId}`);
  const temporaryDOM = join(product, `.otakit-dom-${request.runId}`);
  try {
    await cp(staged, temporary, { recursive: true, errorOnExist: true, force: false });
    if (descriptor.expo?.domRoot)
      await cp(join(staged, 'payload/www.bundle'), temporaryDOM, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    await rm(destination, { recursive: true, force: true });
    await rename(temporary, destination);
    if (descriptor.expo) {
      // Expo's original embedded resolver owns this SDK namespace in the built app.
      // Remove its previous output even when the new export no longer contains DOM.
      await rm(domDestination, { recursive: true, force: true });
      if (descriptor.expo.domRoot) await rename(temporaryDOM, domDestination);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(temporaryDOM, { recursive: true, force: true });
  }
  await writeReceipt(join(output, 'phase.json'), {
    runId: request.runId,
    runtimeVersion: request.nativeBuild.runtimeVersion,
  });
}
