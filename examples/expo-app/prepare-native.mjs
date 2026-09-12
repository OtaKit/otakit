// Reproducible local device resources; this deliberately does not issue a completed-build receipt.
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { prepareUpdates } from './prepare-updates.mjs';

const run = promisify(execFile);
const project = dirname(fileURLToPath(import.meta.url));
const repository = resolve(project, '../..');
export async function prepareNative(platform, directory, option) {
  if (option !== undefined && option !== '--router') throw new Error('Unknown fixture option');
  if (!['ios', 'android'].includes(platform)) throw new Error('Unknown fixture platform');
  const output = directory && resolve(directory);
  if (!output)
    throw new Error(`Usage: node prepare-${platform}.mjs <new directory outside the repo>`);
  const parent = await realpath(dirname(output));
  if (parent === repository || parent.startsWith(repository + '/'))
    throw new Error('Fixture output must be outside the repository');
  await mkdir(output); // Refuse to replace another run, its keys or its archived resources.
  const require = createRequire(join(project, 'package.json'));
  const rnRequire = createRequire(require.resolve('react-native/package.json'));
  const cli = join(repository, 'packages/cli/dist/index.js');
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const bundleKey = randomBytes(32);
  const bundleKeyId = createHash('sha256').update(bundleKey).digest('hex').slice(0, 16);
  const hostFile = join(output, 'host.json');
  await writeFile(
    hostFile,
    JSON.stringify({
      cdnURL: 'http://127.0.0.1:9042',
      channel: null,
      publicKeys: {
        fixture: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      },
      bundleKeys: { [bundleKeyId]: bundleKey.toString('base64') },
      allowLocalhost: true,
    }),
    { mode: 0o600 },
  );
  await writeFile(
    join(output, 'fixture-private.pem'),
    pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  );
  const inputsFile = join(output, 'inputs.json');
  await writeFile(
    inputsFile,
    JSON.stringify({
      appId: 'local-expo-fixture',
      platform,
      nativeApplicationId: 'com.otakit.expofixture',
      variant: 'Release',
      hermesCompiler: join(
        dirname(rnRequire.resolve('hermes-compiler/package.json')),
        'hermesc/osx-bin/hermesc',
      ),
      hermesBytecodeVersion: 98,
      nativeFiles:
        platform === 'android'
          ? [
              hostFile,
              'android-fixture.gradle',
              'android/build.gradle',
              'android/app/build.gradle',
              'android/app/src/main/AndroidManifest.xml',
              'android/app/src/main/java/com/otakit/expofixture/MainApplication.kt',
              'android/app/src/main/java/com/otakit/expofixture/MainActivity.kt',
              'modules/otakit-host/expo-module.config.json',
              'modules/otakit-host/android/build.gradle',
              'modules/otakit-host/android/src/main/AndroidManifest.xml',
              'modules/otakit-host/android/src/main/java/com/otakit/expofixture/host/OtaKitExpoHostPackage.kt',
            ]
          : [
              hostFile,
              'with-ios-fixture.cjs',
              'ios-fixture.sh',
              'ios/Podfile',
              'ios/Podfile.lock',
              'ios/Podfile.properties.json',
              'ios/OtaKitExpoFixture/AppDelegate.swift',
              'ios/OtaKitExpoFixture/Info.plist',
              'ios/OtaKitExpoFixture.xcodeproj/project.pbxproj',
              'modules/otakit-host/expo-module.config.json',
              'modules/otakit-host/ios/OtaKitExpoHostFixture.podspec',
              'modules/otakit-host/ios/OtaKitExpoFixtureHandler.swift',
            ],
      nativeConfiguration: {
        fixture: true,
        engine: 'hermes',
        newArchitecture: true,
        otakitResourceDirectory: 'OtaKitFixture',
        otakitHostConfigurationFile: hostFile,
      },
    }),
  );
  const exported = join(output, 'export');
  const environment = { ...process.env, NODE_ENV: 'production', BABEL_ENV: 'production' };
  await run(
    process.execPath,
    [
      cli,
      'rn',
      'export-embedded',
      '--project',
      project,
      '--native-inputs',
      inputsFile,
      '--entry',
      option === '--router' ? 'expo-router/entry' : 'native-entry.tsx',
      '--version',
      'embedded',
      '--output',
      exported,
    ],
    { env: environment, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const [name, ...others] = await readdir(exported);
  if (!name?.startsWith(`${platform}-`) || others.length)
    throw new Error('Unexpected export layout');
  const embeddedExport = join(exported, name);
  const assets = join(output, 'assets');
  await run(process.execPath, [
    cli,
    'rn',
    'stage-embedded',
    '--embedded-export',
    embeddedExport,
    '--configuration',
    hostFile,
    '--output',
    join(assets, 'OtaKitFixture'),
  ]);
  // Embedded DOM delegates to Expo's normal APK URL. OTA DOM uses its verified artifact root.
  await cp(join(assets, 'OtaKitFixture/payload/www.bundle'), join(assets, 'www.bundle'), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const receipt = JSON.parse(await readFile(join(embeddedExport, 'export.json'), 'utf8'));
  await writeFile(
    join(output, 'fixture.json'),
    JSON.stringify(
      { assets, embeddedExport, receipt, integration: option === '--router' ? 'router' : 'native' },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ assets, embeddedExport }, null, 2));
  await prepareUpdates(output);
}
