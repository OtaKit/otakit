import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
const run = promisify(execFile);
const [device, appPath, fixturesPath] = process.argv.slice(2);
if (!device || !appPath || !fixturesPath)
  throw new Error(
    'Usage: node run-simulator.mjs <booted-simulator-id> <built-app-path> <fixtures-directory>',
  );
const android = device.startsWith('emulator-');
const adb = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools/adb') : 'adb';
const androidRun = (args) => run(adb, ['-s', device, ...args]);
const directory = resolve(fixturesPath);
const cases = JSON.parse(await readFile(join(directory, 'cases.json'), 'utf8'));
const reports = [];
const eventBodies = new Map();
const acceptedEvents = new Map();
const eventErrors = [];
let acceptEvents = false;
let lostEventId;
let lostResponseRetried = false;
let baselineDownloads = 0;
let current = 'good';
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/must-not-download-baseline.zip') baselineDownloads++;
    if (request.url === '/v1/events' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        assert.ok(Buffer.byteLength(body) <= 8192, 'Oversized native event');
      }
      const event = JSON.parse(body);
      assert.equal(request.headers['x-app-id'], cases.good.appId);
      assert.match(event.eventId, /^[0-9a-f-]{36}$/i);
      assert.equal(event.platform, android ? 'android' : 'ios');
      assert.equal(event.runtimeVersion, cases.good.runtimeVersion);
      assert.ok(['downloaded', 'applied', 'download_error', 'rollback'].includes(event.action));
      assert.ok(Object.values(cases).some((item) => item.releaseId === event.releaseId));
      assert.ok(Number.isFinite(Date.parse(event.sentAt)));
      assert.ok(event.nativeBuild.length > 0 && event.nativeBuild.length <= 32);
      if (eventBodies.has(event.eventId)) assert.equal(body, eventBodies.get(event.eventId));
      eventBodies.set(event.eventId, body);
      if (!acceptEvents) {
        response.statusCode = 503;
        response.end();
        return;
      }
      acceptedEvents.set(event.eventId, event);
      if (!lostEventId) {
        lostEventId = event.eventId;
        request.socket.destroy(); // Server committed; client never learns the outcome.
        return;
      }
      if (event.eventId === lostEventId) lostResponseRetried = true;
      response.statusCode = 202;
      response.end();
      return;
    }
    if (request.url === '/report' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1024 * 1024) throw new Error('Oversized report');
      }
      reports.push(JSON.parse(body));
      response.end('ok');
      return;
    }
    if (request.url?.startsWith('/manifests/')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(cases[current]));
      return;
    }
    if (['/good.zip', '/bad.zip', '/crash.zip'].includes(request.url)) {
      response.end(await readFile(join(directory, request.url.slice(1))));
      return;
    }
    if (/^\/files\/[a-f0-9]{64}$/.test(request.url ?? '')) {
      response.end(await readFile(join(directory, request.url.slice(1))));
      return;
    }
    if (request.url === '/oversized.zip') {
      response.write(await readFile(join(directory, 'oversized.zip')));
      response.end(Buffer.alloc(1024 * 1024));
      return;
    }
    if (request.url === '/redirect.zip') {
      response.statusCode = 302;
      response.setHeader('Location', '/good.zip');
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end();
  } catch (error) {
    if (request.url === '/v1/events') eventErrors.push(String(error));
    response.statusCode = 500;
    response.end(String(error));
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(9042, '127.0.0.1', resolve);
});
const appId = 'com.otakit.rnfixture';
async function launch(scenario) {
  if (android) await androidRun(['shell', 'am', 'force-stop', appId]);
  else await run('xcrun', ['simctl', 'terminate', device, appId]).catch(() => undefined);
  const count = reports.length;
  if (android)
    await androidRun([
      'shell',
      'am',
      'start',
      '-n',
      `${appId}/com.helloworld.MainActivity`,
      '--es',
      'otakit-e2e',
      scenario,
    ]);
  else await run('xcrun', ['simctl', 'launch', device, appId, '--otakit-e2e', scenario]);
  const deadline = Date.now() + 60_000;
  while (reports.length === count && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 250));
  assert.ok(reports.length > count, `Timed out waiting for ${scenario} to report from the RN app`);
  return reports.at(-1);
}
try {
  if (android) {
    await androidRun(['uninstall', appId]).catch(() => undefined);
    await androidRun(['install', resolve(appPath)]);
    await androidRun(['reverse', 'tcp:9042', 'tcp:9042']);
  } else {
    await run('xcrun', ['simctl', 'uninstall', device, appId]).catch(() => undefined);
    await run('xcrun', ['simctl', 'install', device, resolve(appPath)]);
  }
  const boot = await launch('boot');
  assert.equal(boot.fixtureVersion, 'embedded');
  assert.equal(boot.error, undefined);
  const updated = await launch('update');
  assert.equal(updated.error, undefined);
  assert.equal(updated.fixtureVersion, 'good');
  assert.equal(updated.state.events.filter((event) => event.type === 'applied').length, 1);
  console.log('PASS encrypted OTA activation and JS readiness');
  current = 'delta';
  const delta = await launch('update');
  assert.equal(delta.error, undefined);
  assert.equal(delta.fixtureVersion, 'delta');
  assert.equal(delta.state.events.filter((event) => event.type === 'applied').length, 2);
  assert.equal(delta.state.previousGood.contentHash, cases.good.contentHash);
  console.log('PASS delta verification and activation');
  current = 'bad';
  const rollback = await launch('rollback');
  assert.equal(rollback.fixtureVersion, 'delta');
  assert.equal(rollback.error, undefined);
  assert.ok(rollback.state.failed.includes(cases.bad.contentHash));
  assert.equal(rollback.state.events.filter((event) => event.type === 'rollback').length, 1);
  console.log('PASS foreground timeout rollback and quarantine');
  const reboot = await launch('boot');
  assert.equal(reboot.fixtureVersion, 'delta');
  assert.equal(reboot.state.events.filter((event) => event.type === 'rollback').length, 1);
  console.log('PASS cold cache verification and single rollback event');
  if (!android || process.env.OTAKIT_TEST_CACHE_FILES === '1') {
    // Android file inspection is opt-in and requires a rooted local emulator.
    const cacheRoot = android
      ? `/data/user/0/${appId}/no_backup/OtaKitRN`
      : join(
          (
            await run('xcrun', ['simctl', 'get_app_container', device, appId, 'data'])
          ).stdout.trim(),
          'Library/Application Support/OtaKitRN',
        );
    const files = async (name) =>
      android
        ? (await androidRun(['shell', 'ls', '-1', `${cacheRoot}/${name}`])).stdout
            .trim()
            .split(/\r?\n/)
            .filter(Boolean)
        : readdir(join(cacheRoot, name));
    const expected = [cases.good.contentHash, cases.delta.contentHash].sort();
    const deadline = Date.now() + 5000;
    let actual;
    do {
      actual = (await files('artifacts')).sort();
      if (JSON.stringify(actual) === JSON.stringify(expected)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.deepEqual(actual, expected);
    assert.ok(
      (await files('receipts')).every((name) =>
        expected.some((hash) => name.startsWith(`${hash}-`)),
      ),
    );
    console.log('PASS asynchronous cache cleanup retains current and previous good artifacts');
  }
  current = 'tampered';
  const rejected = await launch('update');
  assert.ok(rejected.error);
  console.log('PASS tampered signed manifest rejection');
  for (const name of ['oversized', 'redirect']) {
    current = name;
    const rejected = await launch('update');
    assert.ok(rejected.error);
    console.log(`PASS ${name} download rejection`);
  }
  assert.equal((await launch('boot')).fixtureVersion, 'delta');
  current = 'crash';
  const trial = await launch('crash-trial');
  assert.equal(trial.fixtureVersion, 'crash');
  assert.equal(trial.state.trialGeneration, Number(trial.launchContext.generation));
  const recovered = await launch('boot');
  assert.equal(recovered.fixtureVersion, 'delta');
  assert.ok(recovered.state.failed.includes(cases.crash.contentHash));
  assert.equal(recovered.state.events.filter((event) => event.type === 'rollback').length, 2);
  assert.equal(
    (await launch('boot')).state.events.filter((event) => event.type === 'rollback').length,
    2,
  );
  console.log('PASS process-death recovery and single durable rollback');
  if (android) {
    current = 'good';
    const deferred = await launch('headless-guard');
    assert.equal(deferred.error, undefined);
    assert.equal(deferred.deferred, true);
    assert.equal(deferred.fixtureVersion, 'delta');
    assert.equal(deferred.state.staged.contentHash, cases.good.contentHash);
    assert.equal((await launch('boot')).fixtureVersion, 'good');
    console.log('PASS headless task defers activation until a clean foreground process');
  }
  current = 'baseline';
  const embedded = await launch('update');
  assert.equal(embedded.error, undefined);
  assert.equal(embedded.fixtureVersion, 'embedded');
  assert.equal(embedded.state.current.releaseId, 'local-baseline');
  assert.equal(embedded.state.trialGeneration, undefined);
  assert.equal(
    embedded.state.events.filter(
      (event) => event.type === 'applied' && event.artifact.releaseId === 'local-baseline',
    ).length,
    1,
  );
  current = 'associated';
  const association = await launch('associate');
  assert.equal(association.error, undefined);
  assert.equal(association.state.current.releaseId, 'local-associated');
  assert.equal(association.launchContext.releaseId, 'local-baseline');
  assert.equal(association.state.staged, undefined);
  assert.equal(association.state.events.length, embedded.state.events.length);
  assert.equal(baselineDownloads, 0);
  console.log(
    'PASS embedded baseline switch readiness and publication association without download or extra success',
  );
  if (process.env.OTAKIT_TEST_EVENTS === '1') {
    const pending = (await launch('boot')).state.events;
    assert.deepEqual(
      pending
        .filter((event) => event.type === 'downloaded')
        .map((event) => event.artifact.version)
        .sort(),
      ['bad', 'crash', 'delta', 'good'],
    );
    assert.equal(pending.filter((event) => event.type === 'download_error').length, 2);
    acceptEvents = true;
    const deadline = Date.now() + 90_000;
    while ((acceptedEvents.size < pending.length || !lostResponseRetried) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 250));
    assert.deepEqual(eventErrors, []);
    assert.equal(lostResponseRetried, true, 'Lost acceptance response was not retried');
    assert.deepEqual([...acceptedEvents.keys()].sort(), pending.map((event) => event.id).sort());
    assert.equal((await launch('boot')).state.events.length, 0);
    console.log(
      'PASS native event delivery, stable retry identity, server deduplication and durable acknowledgement',
    );
  }
} finally {
  await writeFile(join(directory, 'simulator-results.json'), JSON.stringify(reports, null, 2));
  if (process.env.OTAKIT_TEST_EVENTS === '1')
    await writeFile(
      join(directory, 'event-results.json'),
      JSON.stringify([...acceptedEvents.values()], null, 2),
    );
  await new Promise((resolve) => server.close(resolve));
}
