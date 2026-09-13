const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { runInThisContext } = require('node:vm');
const ts = require('typescript');

// Exercise the published TS entry without loading a device's TurboModule in Node.
const source = ts.transpileModule(readFileSync(join(__dirname, '../src/index.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function api(getState) {
  const exports = {};
  const native = { getState };
  runInThisContext(`(function(require, exports) { ${source}\n})`)((name) => {
    if (name === './bootstrap') return { launchContext: { generation: '1' } };
    if (name === './specs/NativeOtaKit') return { default: native };
    throw new Error(`Unexpected module: ${name}`);
  }, exports);
  return exports;
}

test('last failure is null for a fresh or older native state', async () => {
  for (const state of [{}, { lastFailure: null }]) {
    const client = api(async () => JSON.stringify(state));
    assert.equal(await client.getLastFailure(), null);
    assert.equal(client.OtaKit.getLastFailure, client.getLastFailure);
    assert.equal(client.OtaKit.apply, client.apply);
    assert.deepEqual(await client.OtaKit.getState(), state);
  }
});

test('last failure uses content identity without inventing a transport hash or exposing paths', async () => {
  for (const platform of ['ios', 'android']) {
    const state = {
      events: [], // Telemetry was already delivered.
      lastFailure: {
        appId: 'app',
        platform,
        runtimeVersion: 'runtime',
        contentHash: 'a'.repeat(64),
        version: 'broken',
        bundlePath: '/private/cache/index.bundle',
        embedded: false,
        channel: null,
        releaseId: 'release',
      },
    };
    const client = api(async () => JSON.stringify(state));
    assert.deepEqual(await client.OtaKit.getLastFailure(), {
      id: 'a'.repeat(64),
      appId: 'app',
      framework: 'react-native',
      platform,
      runtimeVersion: 'runtime',
      contentHash: 'a'.repeat(64),
      version: 'broken',
      status: 'error',
      releaseId: 'release',
    });
    assert.deepEqual(await client.getState(), state);
  }
});

test('last failure preserves native storage errors', async () => {
  const error = new Error('STORAGE_UNAVAILABLE');
  const client = api(async () => {
    throw error;
  });
  await assert.rejects(client.getLastFailure(), (actual) => actual === error);
});
