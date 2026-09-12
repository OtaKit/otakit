import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const [device, apkArgument, directoryArgument, option] = process.argv.slice(2);
if (option !== undefined && option !== '--updates') throw new Error('Unknown fixture option');
if (!device?.startsWith('emulator-') || !apkArgument || !directoryArgument)
  throw new Error(
    'Usage: node run-android.mjs <emulator-id> <apk> <prepared-fixture-directory> [--updates]',
  );
const apk = resolve(apkArgument);
const directory = resolve(directoryArgument);
const { receipt } = JSON.parse(await readFile(join(directory, 'fixture.json'), 'utf8'));
const adb = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools/adb') : 'adb';
const android = (args) => run(adb, ['-s', device, ...args], { timeout: 60_000 });
const appId = 'com.otakit.expofixture';
const cases =
  option === '--updates'
    ? JSON.parse(await readFile(join(directory, 'updates/cases.json'), 'utf8'))
    : null;
let selected = null;
let requestUpdate = false;
const downloads = [];

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
    if (cases && request.url?.startsWith('/manifests/') && selected) {
      assert.equal(
        request.url,
        `/manifests/${receipt.appId}/v3/android/__base__/${receipt.runtimeVersion}/manifest.json`,
      );
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(cases[selected]));
      return;
    }
    if (
      cases &&
      ['/good.zip', '/bad.zip', '/crash.zip', '/must-not-download-baseline.zip'].includes(
        request.url,
      )
    ) {
      downloads.push(request.url);
      if (request.url === '/must-not-download-baseline.zip') response.writeHead(500).end();
      else response.end(await readFile(join(directory, 'updates', request.url.slice(1))));
      return;
    }
    if (request.url !== '/report' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      assert.ok(body.length < 1024 * 1024);
    }
    const report = JSON.parse(body);
    reports.push(report);
    const update = requestUpdate && report.phase === 'ready';
    if (update) requestUpdate = false;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ update }));
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
async function waitReport(index) {
  const deadline = Date.now() + 45_000;
  while (reports.length <= index && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 250));
  assert.ok(reports[index], `Missing Expo report ${index}`);
  return reports[index];
}
function assertContent(report, version) {
  assert.equal(report.nativeVersion, `OTAKIT_EXPO_NATIVE_${version.toUpperCase()}`);
  assert.equal(report.dom.version, `OTAKIT_EXPO_DOM_${version.toUpperCase()}`);
  assert.equal(report.dom.htmlVersion, version);
  assert.equal(report.expoConfig.extra.fixtureVersion, version);
  assert.equal(report.context.generation, String(report.state.generation));
  assert.equal(report.context.contentHash, report.state.current.contentHash);
  assert.equal(report.context.runtimeVersion, receipt.runtimeVersion);
  if (version === 'embedded') {
    assert.equal(report.state.current.embedded, true);
    assert.equal(report.context.artifactRoot, null);
    assert.equal(report.context.expoConfig, null);
  } else {
    assert.equal(report.state.current.embedded, false);
    assert.equal(report.context.contentHash, cases[version].contentHash);
    assert.equal(new URL(report.context.artifactRoot).protocol, 'file:');
    assert.deepEqual(report.expoConfig, report.context.expoConfig);
    assert.equal(report.context.expoDomRoot, 'www.bundle');
  }
}
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
    assertContent(reports[launch], 'embedded');
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
  if (cases) {
    async function updateFromColdStart(target, current) {
      selected = target;
      requestUpdate = true;
      const index = reports.length;
      await android(['shell', 'am', 'force-stop', appId]);
      await android(['shell', 'am', 'start', '-n', `${appId}/.MainActivity`]);
      const initial = await waitReport(index);
      const staged = await waitReport(index + 1);
      assertContent(initial, current);
      assert.equal(initial.phase, 'ready');
      assert.equal(staged.phase, 'staged');
      assert.deepEqual(
        staged.context,
        initial.context,
        'Staging must not change the live JS context',
      );
      assert.equal(staged.state.staged.contentHash, cases[target].contentHash);
      const applied = await waitReport(index + 2);
      assert.ok(applied.state.generation > initial.state.generation);
      return { applied, index };
    }
    const { applied: good } = await updateFromColdStart('good', 'embedded');
    assertContent(good, 'good');
    assert.equal(good.phase, 'ready');
    assert.equal(good.state.lastGood.contentHash, cases.good.contentHash);
    assert.ok(cases.good.encryption, 'Exercise the encrypted Expo archive');
    assert.deepEqual(downloads, ['/good.zip']);
    console.log(
      'PASS Expo encrypted OTA reload: native JS, config, DOM script/HTML and immutable context',
    );

    const { applied: bad, index } = await updateFromColdStart('bad', 'good');
    assertContent(bad, 'bad');
    assert.equal(bad.phase, 'unconfirmed');
    assert.equal(bad.state.lastGood.contentHash, cases.good.contentHash);
    const recovered = await waitReport(index + 3);
    assertContent(recovered, 'good');
    assert.equal(recovered.phase, 'ready');
    assert.ok(recovered.state.generation > bad.state.generation);
    assert.ok(recovered.state.failed.includes(cases.bad.contentHash));
    const rollbacks = recovered.state.events.filter((event) => event.type === 'rollback');
    assert.equal(rollbacks.length, 1);
    assert.equal(rollbacks[0].artifact.contentHash, cases.bad.contentHash);
    console.log('PASS Expo unconfirmed update rolls back native JS, config and DOM together');

    await android(['logcat', '-c']);
    const { applied: crash, index: crashIndex } = await updateFromColdStart('crash', 'good');
    assertContent(crash, 'crash');
    assert.equal(crash.phase, 'unconfirmed');
    // Default release error handling must still receive the uncaught JS exception.
    const fatalDeadline = Date.now() + 15_000;
    let fatalLog = '';
    while (Date.now() < fatalDeadline) {
      fatalLog = (await android(['logcat', '-d', '-s', 'AndroidRuntime:E', 'ReactNativeJS:E']))
        .stdout;
      if (
        fatalLog.includes('FATAL EXCEPTION') &&
        fatalLog.includes('OTAKIT_EXPO_INTENTIONAL_FATAL')
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await writeFile(join(directory, `${device}-fatal.log`), fatalLog);
    assert.ok(fatalLog.includes('FATAL EXCEPTION'), 'Expo must preserve the default fatal handler');
    assert.ok(fatalLog.includes('OTAKIT_EXPO_INTENTIONAL_FATAL'));
    await android(['shell', 'am', 'force-stop', appId]);
    await android(['shell', 'am', 'start', '-n', `${appId}/.MainActivity`]);
    const crashRecovered = await waitReport(crashIndex + 3);
    assertContent(crashRecovered, 'good');
    assert.equal(crashRecovered.phase, 'ready');
    assert.ok(crashRecovered.state.generation > crash.state.generation);
    assert.ok(crashRecovered.state.failed.includes(cases.crash.contentHash));
    const crashRollbacks = crashRecovered.state.events.filter(
      (event) =>
        event.type === 'rollback' && event.artifact.contentHash === cases.crash.contentHash,
    );
    assert.equal(crashRollbacks.length, 1);
    console.log(
      'PASS Expo fatal JS error reaches RN handler and cold restart restores confirmed OTA',
    );

    const { applied: embedded } = await updateFromColdStart('baseline', 'good');
    assertContent(embedded, 'embedded');
    assert.equal(embedded.state.current.releaseId, 'expo-baseline');
    assert.equal(embedded.state.lastGood.contentHash, receipt.embeddedReceipt.embeddedContentHash);
    assert.deepEqual(downloads, ['/good.zip', '/bad.zip', '/crash.zip']);
    console.log(
      'PASS Expo embedded baseline restores original Constants/DOM without an archive request',
    );
  }
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
  try {
    await writeFile(join(directory, `${device}-reports.json`), JSON.stringify(reports, null, 2));
  } finally {
    await android(['shell', 'am', 'force-stop', appId]).catch(() => {});
    await android(['reverse', '--remove', 'tcp:9042']).catch(() => {});
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
