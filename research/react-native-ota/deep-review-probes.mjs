// Review counterexamples, not RN implementation or database integration tests.
// Run: node research/react-native-ota/deep-review-probes.mjs [snapshot-directory]
// No network, credentials, native builds, or persistent application writes.
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const snapshots = resolve(
  process.argv[2] ?? join(root, '../otakit-references/react-native-ota/source-snapshots'),
);
const nodeRequire = createRequire(import.meta.url);
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
let checks = 0;
async function check(label, run) {
  await run();
  checks++;
  console.log(`CONFIRMED ${label}`);
}

function evaluateCommonJS(source, filename, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      Buffer,
      console,
      require(id) {
        if (id.startsWith('node:') || ['path', 'fs'].includes(id)) return nodeRequire(id);
        assert.ok(Object.hasOwn(dependencies, id), `Unexpected import ${id} in ${filename}`);
        return dependencies[id];
      },
    },
    { filename, timeout: 2000 },
  );
  return module.exports;
}

async function loadTS(relative, dependencies = {}) {
  const filename = join(root, relative);
  const source = await readFile(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  return evaluateCommonJS(compiled, filename, dependencies);
}

// Run real release service control flow against a small sequential database fake.
// It implements only the predicates used below. It does not simulate PostgreSQL
// constraints, transaction rollback, advisory locks, concurrency, or CDN writes.
function databaseFixture() {
  const bundles = new Map(
    ['baseline', 'ota'].map((id) => [
      id,
      { id, appId: 'app', version: id, runtimeVersion: 'runtime', nativePackages: [] },
    ]),
  );
  const releases = [];
  const mutations = [];
  let sequence = 0;
  function includeBundle(row) {
    if (!row) return null;
    return {
      ...row,
      bundle: bundles.get(row.bundleId),
      previousBundle: bundles.get(row.previousBundleId) ?? null,
    };
  }
  function mutationKey(query) {
    return query.organizationId_actorKey_operation_idempotencyKey;
  }
  const database = {
    $transaction: async (run) => run(database),
    $executeRaw: async () => 0,
    bundle: {
      findFirst: async ({ where }) => {
        const bundle = bundles.get(where.id);
        return bundle?.appId === where.appId ? bundle : null;
      },
    },
    release: {
      findFirst: async ({ where }) => {
        const rows = releases.filter(
          (row) =>
            row.appId === where.appId &&
            (where.id === undefined || row.id === where.id) &&
            (where.channel === undefined || row.channel === where.channel) &&
            (where.revertedAt !== null || row.revertedAt === null) &&
            (!where.bundle ||
              bundles.get(row.bundleId).runtimeVersion === where.bundle.is.runtimeVersion),
        );
        rows.sort((a, b) => b.promotedAt - a.promotedAt || b.id.localeCompare(a.id));
        return includeBundle(rows[0]);
      },
      create: async ({ data }) => {
        const row = {
          ...data,
          id: `release-${++sequence}`,
          promotedAt: new Date(Date.now() + sequence),
          revertedAt: null,
          revertedBy: null,
        };
        releases.push(row);
        return includeBundle(row);
      },
      update: async ({ where, data }) => {
        const row = releases.find((item) => item.id === where.id);
        assert.ok(row);
        Object.assign(row, data);
        return includeBundle(row);
      },
    },
    releaseMutation: {
      findUnique: async ({ where }) =>
        mutations.find((row) =>
          Object.entries(mutationKey(where)).every(([key, value]) => row[key] === value),
        ) ?? null,
      create: async ({ data }) => {
        const row = { ...data };
        mutations.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = mutations.find((item) => item.id === where.id);
        assert.ok(row);
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }) => {
        const index = mutations.findIndex((item) => item.id === where.id);
        assert.ok(index >= 0);
        return mutations.splice(index, 1)[0];
      },
    },
  };
  return { database, mutations, releases };
}

const errors = await loadTS('packages/console/lib/services/errors.ts');
const service = await loadTS('packages/console/lib/services/releases.ts', {
  '@/lib/audit-log': { recordAuditLog: async () => {} },
  '@/lib/db': {},
  '@/lib/manifest-files': {},
  '@/lib/releases': {},
  '@/lib/tinybird/events': {},
  '@/lib/validation': {
    isValidChannelName: (value) => value === 'production',
    isValidRuntimeVersion: (value) => value === 'runtime',
  },
  './errors': errors,
  './native-compatibility': {
    compareBundleNativePackages: () => ({ status: 'compatible', findings: [] }),
  },
});
const actor = { actorType: 'key', actorId: 'token-a', actorLabel: 'CI' };
const common = { organizationId: 'org', actor, appId: 'app', channel: 'production' };
const dependencies = (fixture) => ({
  database: fixture.database,
  syncManifest: async () => {},
});
const publish = (fixture, bundleId, key, expected, extra = {}) =>
  service.publishRelease(
    {
      ...common,
      bundleId,
      idempotencyKey: key,
      expectedCurrentReleaseId: expected,
      ...extra,
    },
    dependencies(fixture),
  );
async function revert(fixture, publication) {
  return service.revertRelease(
    {
      ...common,
      releaseId: publication.release.id,
      expectedCurrentReleaseId: publication.release.id,
      idempotencyKey: `revert-${publication.release.id}`,
    },
    dependencies(fixture),
  );
}

await check('shared service allows a first publication whose revert has no target', async () => {
  const fixture = databaseFixture();
  const first = await publish(fixture, 'ota', 'first-ota', null);
  assert.equal(first.release.previousBundleId, null);
  assert.equal((await revert(fixture, first)).currentRelease, null);
});

async function revertedPublicationFixture() {
  const fixture = databaseFixture();
  const baseline = await publish(fixture, 'baseline', 'baseline', null);
  const first = await publish(fixture, 'ota', 'ota-original', baseline.release.id);
  const reverted = await revert(fixture, first);
  assert.equal(reverted.currentRelease.id, baseline.release.id);
  return { fixture, baseline, first };
}

await check(
  'same-actor unexpired retry replays the reverted publication without republishing',
  async () => {
    const { fixture, baseline, first } = await revertedPublicationFixture();
    const retry = await publish(fixture, 'ota', 'ota-original', baseline.release.id);
    assert.equal(retry.release.id, first.release.id);
    assert.equal(fixture.releases.length, 2);
  },
);

await check(
  'expired operation plus restored prior release republishes a reverted bundle',
  async () => {
    const { fixture, baseline, first } = await revertedPublicationFixture();
    fixture.mutations.find((item) => item.id === first.operationId).expiresAt = new Date(0);
    const retry = await publish(fixture, 'ota', 'ota-original', baseline.release.id);
    assert.notEqual(retry.release.id, first.release.id);
    assert.equal(fixture.releases.length, 3);
    assert.equal(retry.release.revertedAt, null);
  },
);

await check(
  'changing API actor also republishes a reverted bundle under the same operation key',
  async () => {
    const { fixture, baseline, first } = await revertedPublicationFixture();
    const retry = await publish(fixture, 'ota', 'ota-original', baseline.release.id, {
      actor: { ...actor, actorId: 'token-b' },
    });
    assert.notEqual(retry.release.id, first.release.id);
    assert.equal(fixture.releases.length, 3);
  },
);

const work = await mkdtemp(join(tmpdir(), 'otakit-deep-review-'));
try {
  await check(
    'independent encryption of the same baseline produces conflicting transfer identities',
    async () => {
      const { encryptFile } = await loadTS('packages/cli/src/lib/crypto.ts');
      const input = join(work, 'baseline.zip');
      await writeFile(input, 'identical archived baseline fixture');
      const key = crypto.randomBytes(32);
      const one = await encryptFile(key, input, join(work, 'one.enc'));
      const two = await encryptFile(key, input, join(work, 'two.enc'));
      const firstBytes = await readFile(join(work, 'one.enc'));
      const secondBytes = await readFile(join(work, 'two.enc'));
      assert.equal(firstBytes.length, secondBytes.length);
      assert.equal(one.kid, two.kid);
      assert.notEqual(digest(firstBytes), digest(secondBytes));
      assert.notEqual(one.nonce, two.nonce);
      // The proposed finalize equality includes the transport hash and envelope;
      // a separate content-based baseline adoption operation would be needed.
    },
  );

  const exporterFile = join(
    snapshots,
    'released-packages/@expo__cli-57.0.19/build/src/export/metroAssetLocalPath.js',
  );
  const exporterBytes = await readFile(exporterFile);
  assert.equal(
    digest(exporterBytes),
    'fb7e2a841313fd622783f622078b314b4320a86bb8729f246a85b415f9036107',
    'Additional reviewed Expo source changed',
  );
  const exporter = evaluateCommonJS(exporterBytes.toString(), exporterFile);
  console.log(`Additional saved source SHA-256: metroAssetLocalPath.js ${digest(exporterBytes)}`);
  const persistFile = join(
    snapshots,
    'released-packages/@expo__cli-57.0.19/build/src/export/persistMetroAssets.js',
  );
  const persistBytes = await readFile(persistFile);
  assert.equal(
    digest(persistBytes),
    'a2946ee31207b7016116add39ce8d108722b45bccc0fc4d519488d8a97ef4fc9',
    'Additional reviewed Expo source changed',
  );
  const persister = evaluateCommonJS(persistBytes.toString(), persistFile, {
    './metroAssetLocalPath': exporter,
    '../log': { Log: { log() {}, warn() {}, error() {} } },
  });
  await check(
    'published Expo exporter overwrites distinct assets before inventory validation',
    async () => {
      const options = { platform: 'android', scale: 1 };
      const asset = { httpServerLocation: '/assets/icons', type: 'png' };
      const left = exporter.getAssetLocalPath({ ...asset, name: 'log-in' }, options);
      const right = exporter.getAssetLocalPath({ ...asset, name: 'login' }, options);
      assert.equal(left, right);
      assert.equal(left, 'drawable-mdpi/icons_login.png');
      const firstFile = join(work, 'log-in.png');
      const secondFile = join(work, 'login.png');
      await writeFile(firstFile, 'first asset bytes');
      await writeFile(secondFile, 'second asset bytes');
      const output = join(work, 'export');
      await persister.persistMetroAssetsAsync(
        work,
        [
          { ...asset, name: 'log-in', scales: [1], files: [firstFile] },
          { ...asset, name: 'login', scales: [1], files: [secondFile] },
        ],
        { platform: 'android', outputDirectory: output },
      );
      assert.equal(await readFile(join(output, left), 'utf8'), 'second asset bytes');
    },
  );

  await check(
    'delivery path model accepts a filename exceeding Android filesystem byte limits',
    () => {
      const output = execFileSync(
        'python3',
        [
          '-B',
          '-c',
          `import runpy
from pathlib import Path
model = runpy.run_path(${JSON.stringify(join(root, 'research/react-native-ota/verify-delivery-plan.py'))})
name = '\u00e9' * 140 + '.png'
model['validate_paths'](['www.bundle/' + name])
assert len(name.encode('utf-8')) == 284
print('Model accepts 144 characters / 284 UTF-8 bytes in one filename.')
try:
    target = Path(${JSON.stringify(work)}) / name
    target.write_bytes(b'fixture')
    assert target.read_bytes() == b'fixture'
    print('Local filesystem creates and reads this filename.')
except OSError as error:
    print('Local filesystem rejects it with errno', error.errno)
`,
        ],
        { encoding: 'utf8' },
      );
      console.log(output.trim());
    },
  );
} finally {
  await rm(work, { recursive: true, force: true });
}

// Replay the existing probes, substituting only their fetch/extraction phase.
// Each saved file must match the original inventory. This does NOT revalidate
// the seven whole-tarball integrities or establish current registry availability.
let verifier = await readFile(new URL('./verify-integration.mjs', import.meta.url), 'utf8');
verifier = verifier.replace("from 'typescript'", `from '${import.meta.resolve('typescript')}'`);
verifier = verifier.replace(
  "new URL('./integration-sources.json', import.meta.url)",
  JSON.stringify(fileURLToPath(new URL('./integration-sources.json', import.meta.url))),
);
const start = verifier.indexOf('// Read members directly');
const end = verifier.indexOf('\nfunction source(key)', start);
assert.ok(start >= 0 && end > start, 'Upstream verifier layout changed; inspect before replaying');
verifier =
  verifier.slice(0, start) +
  `
const snapshotRoot = ${JSON.stringify(snapshots)};
for (const pkg of inventory.packages) {
  for (const file of pkg.files) {
    const path = snapshotRoot + '/released-packages/' + pkg.name.replaceAll('/', '__') + '-' + pkg.version + '/' + file.path;
    record(pkg.name + '/' + file.path, await readFile(path), file.sha256);
  }
}
for (const rn of inventory.reactNative) {
  for (const file of rn.files) {
    record('rn-' + rn.version + '/' + file.path,
      await readFile(snapshotRoot + '/rn-' + rn.version + '/' + file.path), file.sha256);
  }
}
console.log('Offline replay: verified ' + hashedFiles + ' saved source hashes; tarball integrity not reverified.');
` +
  verifier.slice(end);
await import('data:text/javascript;base64,' + Buffer.from(verifier).toString('base64'));
console.log(`\n${checks} review checks confirmed; limits are documented in deep-review.md.`);
