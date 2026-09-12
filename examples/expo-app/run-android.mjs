import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const [device, apkArgument, directoryArgument] = process.argv.slice(2);
if (!device?.startsWith('emulator-') || !apkArgument || !directoryArgument)
  throw new Error('Usage: node run-android.mjs <emulator-id> <apk> <prepared-fixture-directory>');
const apk = resolve(apkArgument);
const directory = resolve(directoryArgument);
const { receipt } = JSON.parse(await readFile(join(directory, 'fixture.json'), 'utf8'));
const adb = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools/adb') : 'adb';
const android = (args) => run(adb, ['-s', device, ...args], { timeout: 60_000 });
const appId = 'com.otakit.expofixture';

// Expo's embedded URL reads a second copy from APK assets. Verify it against the sealed inventory.
for (const file of receipt.files.filter((file) => file.path.startsWith('www.bundle/'))) {
  const { stdout } = await run('unzip', ['-p', apk, `assets/${file.path}`], {
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(stdout.length, file.size);
  assert.equal(createHash('sha256').update(stdout).digest('hex'), file.sha256);
}
const reports = [];
const server = createServer(async (request, response) => {
  try {
    if (request.url !== '/report' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      assert.ok(body.length < 1024 * 1024);
    }
    reports.push(JSON.parse(body));
    response.end('ok');
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(9042, '127.0.0.1', resolve);
});
try {
  await android(['reverse', 'tcp:9042', 'tcp:9042']);
  await android(['install', '-r', apk]);
  await android(['shell', 'pm', 'clear', appId]);
  for (let launch = 0; launch < 2; launch++) {
    await android(['shell', 'am', 'force-stop', appId]);
    await android(['shell', 'am', 'start', '-n', `${appId}/.MainActivity`]);
    const deadline = Date.now() + 45_000;
    while (reports.length <= launch && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(reports.length, launch + 1, 'Missing or duplicate Expo DOM readiness report');
    const { context, state, expoConfig, domReady } = reports[launch];
    assert.equal(domReady, true);
    assert.equal(state.current.embedded, true);
    assert.equal(state.current.contentHash, receipt.embeddedReceipt.embeddedContentHash);
    assert.equal(context.contentHash, state.current.contentHash);
    assert.equal(context.runtimeVersion, receipt.runtimeVersion);
    assert.equal(context.generation, String(state.generation));
    assert.equal(context.artifactRoot, null);
    assert.equal(expoConfig.extra.fixtureVersion, 'embedded');
    assert.equal(state.lastGood.contentHash, state.current.contentHash);
    assert.deepEqual(state.failed, []);
    if (launch) assert.ok(state.generation > reports[0].state.generation);
  }
  await writeFile(join(directory, `${device}-reports.json`), JSON.stringify(reports, null, 2));
  const screenshot = await run(adb, ['-s', device, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer',
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  await writeFile(join(directory, `${device}.png`), screenshot.stdout);
  console.log(
    `PASS ${device}: verified APK DOM, Expo Constants, DOM readiness, process restart generations`,
  );
} finally {
  await android(['shell', 'am', 'force-stop', appId]).catch(() => {});
  await android(['reverse', '--remove', 'tcp:9042']).catch(() => {});
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
