// Opt-in acceptance of actual npm tarballs in an isolated application, never workspace links.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let destination = process.argv[2] && resolve(process.argv[2]);
if (!destination || destination === repository || destination.startsWith(`${repository}/`))
  throw new Error('Usage: node verify-package.mjs <new directory outside the repository>');
await mkdir(destination); // Never replace an existing acceptance application.
destination = await realpath(destination);
const tarballs = join(destination, 'tarballs');
await mkdir(tarballs);
const archives = [];
const versions = [];
for (const name of ['updater-core', 'react-native-plugin']) {
  const manifest = JSON.parse(
    await readFile(join(repository, 'packages', name, 'package.json'), 'utf8'),
  );
  archives.push(
    join(tarballs, `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`),
  );
  versions.push(manifest.version);
  await run('pnpm', ['pack', '--pack-destination', tarballs], {
    cwd: join(repository, 'packages', name),
  });
}
const [core, plugin] = archives;
for (const archive of [core, plugin]) {
  const files = (await run('tar', ['-tzf', archive])).stdout.trim().split('\n');
  assert.ok(files.includes('package/LICENSE'));
  if (archive === plugin) assert.ok(files.includes('package/scripts/android.gradle'));
  if (archive === plugin) assert.ok(files.includes('package/scripts/xcode.sh'));
  assert.ok(
    files.every(
      (file) =>
        !/(?:^|\/)(?:build|\.build|\.gradle|node_modules|fixtures|Tests|test)(?:\/|$)|\.test\.|\.map$|\.keystore$/.test(
          file,
        ),
    ),
  );
}
const fixture = join(repository, 'examples/react-native-app');
const project = join(destination, 'application');
await cp(fixture, project, {
  recursive: true,
  filter: (path) => {
    const components = relative(fixture, path).split('/');
    return !components.some((name) =>
      [
        'node_modules',
        'Pods',
        'build',
        '.gradle',
        '.cxx',
        '.kotlin',
        'DerivedData',
        'xcuserdata',
        '.xcode.env.local',
        'local.properties',
      ].includes(name),
    );
  },
});
const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
manifest.dependencies['@otakit/react-native-updater'] = `file:${plugin}`;
manifest.pnpm = { overrides: { '@otakit/updater-core': `file:${core}` } };
await writeFile(join(project, 'package.json'), JSON.stringify(manifest, null, 2));
// This app has no workspace to watch. Use the ordinary installed package resolver.
await writeFile(
  join(project, 'metro.config.js'),
  `const {getDefaultConfig} = require('@react-native/metro-config');
const {withOtaKitMetro} = require('@otakit/react-native-updater/metro');
module.exports = withOtaKitMetro({...getDefaultConfig(__dirname), maxWorkers: 2});\n`,
);
await run('pnpm', ['install', '--prefer-offline'], {
  cwd: project,
  timeout: 120_000,
  maxBuffer: 4 * 1024 * 1024,
});
const config = JSON.parse(
  (
    await run(
      process.execPath,
      ['node_modules/@react-native-community/cli/build/bin.js', 'config'],
      {
        cwd: project,
        env: { ...process.env, NODE_PATH: '' },
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    )
  ).stdout,
);
const dependency = config.dependencies['@otakit/react-native-updater'];
assert.ok(dependency.platforms.ios.podspecPath);
assert.equal(dependency.platforms.android.libraryName, 'OtaKitRNSpec');
const installed = await realpath(dependency.root);
assert.ok(installed.startsWith(`${project}/node_modules/`));
assert.ok(!JSON.stringify(config).includes(repository));
const installedManifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
assert.equal(installedManifest.dependencies['@otakit/updater-core'], versions[0]);
await writeFile(join(destination, 'autolinking.json'), JSON.stringify(config, null, 2));
console.log(`PASS packed source inventory and isolated native autolinking: ${project}`);
console.log(
  'Next run pod install, Release native builds and the device runner in this application.',
);
