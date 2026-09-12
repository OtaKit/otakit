// Local device test resources, not a native-build receipt producer for application releases.
import { createCipheriv, createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const project = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(project, '../../packages/cli/package.json'));
const yazl = require('yazl');
const [input, destination] = process.argv.slice(2).map((value) => resolve(value));
if (!input || !destination)
  throw new Error(
    'Usage: node prepare-simulator.mjs <verified-export-directory> <local-output-directory>',
  );
const receipt = JSON.parse(await readFile(join(input, 'export.json'), 'utf8'));
if (receipt.purpose !== 'embedded')
  throw new Error('Prepare the fixture from an embedded export, not an OTA export');
const original = await readFile(join(input, 'private/index.js'), 'utf8');
const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const key = randomBytes(32);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const kid = hash(key).slice(0, 16);
const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
await mkdir(destination, { recursive: true });
const platform = receipt.platform;
if (!['ios', 'android'].includes(platform)) throw new Error('Unsupported fixture platform');
const resources = join(
  project,
  platform === 'ios' ? 'ios/HelloWorld/OtaKitFixture' : 'android/app/src/main/assets/OtaKitFixture',
);
await mkdir(resources, { recursive: true });
// Regeneration must not leave assets from an older embedded export in the native package.
await rm(join(resources, 'payload'), { recursive: true, force: true });
await cp(join(input, 'payload'), join(resources, 'payload'), { recursive: true });
await cp(join(input, 'otakit-embedded.json'), join(resources, 'otakit-embedded.json'));
await cp(
  join(project, '../../packages/rn-protocol/src/unicode/case-folding-15.0.0.json'),
  join(resources, 'case-folding.json'),
);
await writeFile(
  join(resources, 'configuration.json'),
  JSON.stringify({
    cdnURL: 'http://127.0.0.1:9042',
    ...(process.env.OTAKIT_TEST_EVENTS === '1' ? { ingestURL: 'http://127.0.0.1:9042/v1' } : {}),
    channel: null,
    nativeBuildId: receipt.nativeBuildId,
    reactNativeVersion: '0.86.3',
    hermesBytecodeVersion: 98,
    embeddedReceipt: receipt.embeddedReceipt,
    publicKeys: { fixture: publicKey },
    bundleKeys: { [kid]: key.toString('base64') },
    allowLocalhost: true,
  }),
  { mode: 0o600 },
);

function seal(key, nonce, bytes) {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  return Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
}
const cases = {};
for (const name of ['good', 'delta', 'bad', 'crash', 'oversized']) {
  const source = join(destination, `${name}.js`);
  const marker = "var fixtureVersion = exports.fixtureVersion = 'embedded';";
  if (original.split(marker).length !== 2)
    throw new Error('Fixture module changed; update its exact replacement marker');
  let javascript = original.replace(
    marker,
    `var fixtureVersion = exports.fixtureVersion = '${name}';`,
  );
  if (name === 'bad' || name === 'crash') {
    const marker = 'var withholdReadiness = exports.withholdReadiness = false;';
    if (javascript.split(marker).length !== 2) throw new Error('Readiness marker changed');
    javascript = javascript.replace(
      marker,
      'var withholdReadiness = exports.withholdReadiness = true;',
    );
  }
  await writeFile(source, javascript);
  const bundle = join(destination, `${name}.bundle`);
  const rnRequire = createRequire(
    createRequire(join(project, 'package.json')).resolve('react-native/package.json'),
  );
  const compiler =
    platform === 'ios'
      ? join(project, 'ios/Pods/hermes-engine/destroot/bin/hermesc')
      : join(dirname(rnRequire.resolve('hermes-compiler/package.json')), 'hermesc/osx-bin/hermesc');
  execFileSync(compiler, ['-O', '-emit-binary', '-out', bundle, source]);
  const contents = new Map();
  for (const file of receipt.files)
    contents.set(file.path, await readFile(join(input, 'payload', file.path)));
  contents.set('index.bundle', await readFile(bundle));
  const descriptor = JSON.parse(contents.get('otakit-bundle.json').toString('utf8'));
  descriptor.version = name;
  contents.set('otakit-bundle.json', Buffer.from(JSON.stringify(descriptor) + '\n'));
  const files = [...contents].map(([path, bytes]) => ({
    path,
    sha256: hash(bytes),
    size: bytes.length,
  }));
  const contentHash = hash(
    files
      .slice()
      .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
      .map((file) => `${file.path}:${file.sha256}`)
      .join('\n'),
  );
  await mkdir(join(destination, 'files'), { recursive: true });
  for (const file of files)
    await writeFile(join(destination, 'files', file.sha256), contents.get(file.path));
  const zip = new yazl.ZipFile();
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.on('end', resolve);
    zip.outputStream.on('error', reject);
  });
  for (const [path, bytes] of contents) zip.addBuffer(bytes, path, { mode: 0o100644 });
  zip.end();
  await complete;
  let bytes = Buffer.concat(chunks);
  let encryption = null;
  if (name === 'good') {
    const dek = randomBytes(32);
    const wrapNonce = randomBytes(12);
    const nonce = randomBytes(12);
    encryption = {
      alg: 'AES-256-GCM',
      kid,
      wrapNonce: wrapNonce.toString('base64'),
      nonce: nonce.toString('base64'),
      wrappedDek: seal(key, wrapNonce, dek).toString('base64'),
    };
    bytes = seal(dek, nonce, bytes);
  }
  await writeFile(join(destination, `${name}.zip`), bytes);
  const now = Math.floor(Date.now() / 1000);
  const strategy = name === 'delta' ? 'deltas' : 'zip';
  const m = {
    schemaVersion: 3,
    appId: receipt.appId,
    framework: 'react-native',
    platform,
    channel: null,
    version: name,
    sha256: strategy === 'zip' ? hash(bytes) : contentHash,
    contentHash,
    size: strategy === 'zip' ? bytes.length : files.reduce((total, file) => total + file.size, 0),
    runtimeVersion: receipt.runtimeVersion,
    strategy,
    forceImmediate: false,
    encryption,
    releaseId: `local-${name}`,
    signature: { kid: 'fixture', iat: now, exp: now + 3600 },
    ...(strategy === 'zip'
      ? { url: `http://127.0.0.1:9042/${name}.zip` }
      : {
          files: files.map((file) => ({
            ...file,
            url: `http://127.0.0.1:9042/files/${file.sha256}`,
          })),
        }),
  };
  cases[name] = signManifest(m);
}
function signManifest(m) {
  const encryption = m.encryption;
  const canonical = [
    'MANIFEST:3',
    ...['appId', 'framework', 'platform'].map((k) => `${k}:${m[k]}`),
    'channel:null',
    ...[
      'version',
      'sha256',
      'contentHash',
      'size',
      'runtimeVersion',
      'strategy',
      'forceImmediate',
    ].map((k) => `${k}:${m[k]}`),
    `encryption:${encryption ? [encryption.alg, encryption.kid, encryption.wrapNonce, encryption.wrappedDek, encryption.nonce].join('|') : 'null'}`,
    `releaseId:${m.releaseId}`,
    'kid:fixture',
    `iat:${m.signature.iat}`,
    `exp:${m.signature.exp}`,
  ].join('\n');
  m.signature.sig = sign('sha256', Buffer.from(canonical), pair.privateKey).toString('base64url');
  return m;
}
cases.baseline = signManifest({
  ...cases.good,
  version: receipt.embeddedReceipt.version,
  contentHash: receipt.embeddedReceipt.embeddedContentHash,
  sha256: receipt.sha256,
  size: (await readFile(join(input, receipt.archive))).length,
  encryption: null,
  releaseId: 'local-baseline',
  url: 'http://127.0.0.1:9042/must-not-download-baseline.zip',
  signature: { ...cases.good.signature },
});
cases.associated = signManifest({
  ...cases.baseline,
  releaseId: 'local-associated',
  signature: { ...cases.baseline.signature },
});
cases.tampered = { ...cases.good, releaseId: 'tampered-release' };
cases.redirect = { ...cases.oversized, url: 'http://127.0.0.1:9042/redirect.zip' };
await writeFile(join(destination, 'cases.json'), JSON.stringify(cases, null, 2));
console.log(`Prepared localhost fixtures in ${destination}`);
