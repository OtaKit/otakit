// Derive local signed device faults from a hook-built baseline and its matching test keys.
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareUpdates } from './prepare-updates.mjs';

const [destination, keysDirectory, buildDirectory] = process.argv.slice(2);
if (!destination || !keysDirectory || !buildDirectory || process.argv.length !== 5)
  throw new Error(
    'Usage: node prepare-completed.mjs <new directory> <prepared fixture> <completed build directory>',
  );
const output = resolve(destination);
const repository = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const parent = await realpath(dirname(output));
if (parent === repository || parent.startsWith(repository + '/'))
  throw new Error('Fixture output must be outside the repository');
const build = await realpath(buildDirectory);
const completed = JSON.parse(await readFile(join(build, 'completed-build.json')));
assert.equal(completed.format, 'otakit-rn-completed-build');
assert.equal(completed.version, 1);
const { platform, runtimeVersion } = completed.baseline;
assert.ok(['ios', 'android'].includes(platform));
const embeddedExport = join(build, 'export', `${platform}-${runtimeVersion}`);
const receipt = JSON.parse(await readFile(join(embeddedExport, 'export.json')));
assert.deepEqual(receipt, completed.baseline);
const inputsFile = join(build, 'native-inputs.json');
const inputs = JSON.parse(await readFile(inputsFile));
const configuration = JSON.parse(
  await readFile(inputs.nativeConfiguration.otakitHostConfigurationFile),
);
assert.deepEqual(configuration, JSON.parse(await readFile(join(keysDirectory, 'host.json'))));
await mkdir(output, { mode: 0o700 });
for (const name of ['host.json', 'fixture-private.pem'])
  await copyFile(join(keysDirectory, name), join(output, name));
await copyFile(inputsFile, join(output, 'inputs.json'));
await writeFile(
  join(output, 'fixture.json'),
  JSON.stringify(
    {
      embeddedExport,
      receipt,
      integration: 'router',
      completedBuild: join(build, 'completed-build.json'),
    },
    null,
    2,
  ),
);
await prepareUpdates(output);
console.log(output);
