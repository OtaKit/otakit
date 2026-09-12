// Run from this checkout after installing workspace dependencies. All keys here are test-only.
import { createCipheriv, createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../cli/package.json', import.meta.url));
const yazl = require('yazl');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const descriptor = {
  format: 'otakit-rn',
  formatVersion: 1,
  framework: 'react-native',
  platform: 'ios',
  runtimeVersion: 'A'.repeat(43),
  version: 'fixture-1',
  entryPoint: 'index.bundle',
  engine: 'hermes',
  bundleFormat: 'hermes-bytecode',
  reactNativeVersion: '0.86.3',
  expo: { configFile: 'expo-config.json', domRoot: 'www.bundle' },
};
const contents = {
  'index.bundle': Buffer.from('c61fbc03c103191f6000000066697874757265', 'hex'),
  'otakit-bundle.json': Buffer.from(JSON.stringify(descriptor)),
  'assets/café #1%.txt': Buffer.from('unicode asset'),
  'expo-config.json': Buffer.from('{"name":"fixture"}'),
  'www.bundle/index.html': Buffer.from('<html>fixture</html>'),
};
const files = Object.entries(contents).map(([path, data]) => ({
  path,
  sha256: hash(data),
  size: data.length,
  url: `https://cdn.example/${encodeURIComponent(path)}`,
}));
const contentHash = hash(
  files
    .slice()
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
    .map((f) => `${f.path}:${f.sha256}`)
    .join('\n'),
);
const archive = new yazl.ZipFile();
const chunks = [];
const finished = new Promise((resolve, reject) => {
  archive.outputStream.on('data', (chunk) => chunks.push(chunk));
  archive.outputStream.on('end', resolve);
  archive.outputStream.on('error', reject);
});
for (const [path, data] of Object.entries(contents))
  archive.addBuffer(data, path, { mtime: new Date('1980-01-01'), mode: 0o100644 });
archive.end();
await finished;
const plain = Buffer.concat(chunks);
const key = randomBytes(32);
const dek = randomBytes(32);
const wrapNonce = randomBytes(12);
const nonce = randomBytes(12);
function seal(key, nonce, bytes) {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  return Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
}
const encrypted = seal(dek, nonce, plain);
const encryption = {
  alg: 'AES-256-GCM',
  kid: hash(key).slice(0, 16),
  wrapNonce: wrapNonce.toString('base64'),
  wrappedDek: seal(key, wrapNonce, dek).toString('base64'),
  nonce: nonce.toString('base64'),
};
const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
function signed(strategy, bytes, envelope) {
  const m = {
    schemaVersion: 3,
    appId: 'app-1',
    framework: 'react-native',
    platform: 'ios',
    channel: null,
    version: descriptor.version,
    sha256: strategy === 'zip' ? hash(bytes) : contentHash,
    contentHash,
    size: strategy === 'zip' ? bytes.length : files.reduce((total, f) => total + f.size, 0),
    runtimeVersion: descriptor.runtimeVersion,
    strategy,
    forceImmediate: false,
    encryption: envelope,
    releaseId: `release-${strategy}-${envelope ? 'encrypted' : 'plain'}`,
    signature: { kid: 'fixture', iat: 1000, exp: 31537000 },
    ...(strategy === 'zip' ? { url: 'https://cdn.example/archive.zip' } : { files }),
  };
  const e = envelope
    ? [envelope.alg, envelope.kid, envelope.wrapNonce, envelope.wrappedDek, envelope.nonce].join(
        '|',
      )
    : 'null';
  const canonical = [
    'MANIFEST:3',
    ...['appId', 'framework', 'platform'].map((k) => `${k}:${m[k]}`),
    `channel:${JSON.stringify(m.channel)}`,
    ...[
      'version',
      'sha256',
      'contentHash',
      'size',
      'runtimeVersion',
      'strategy',
      'forceImmediate',
    ].map((k) => `${k}:${m[k]}`),
    `encryption:${e}`,
    `releaseId:${m.releaseId}`,
    'kid:fixture',
    'iat:1000',
    'exp:31537000',
  ].join('\n');
  m.signature.sig = sign('sha256', Buffer.from(canonical), pair.privateKey).toString('base64url');
  return { manifest: m, canonical };
}
const fixture = {
  description: 'Synthetic bytecode for verification tests only; not executable Hermes code.',
  publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  bundleKey: key.toString('base64'),
  contents: Object.fromEntries(Object.entries(contents).map(([p, b]) => [p, b.toString('base64')])),
  archive: plain.toString('base64'),
  encryptedArchive: encrypted.toString('base64'),
  cases: [
    signed('zip', plain, null),
    signed('zip', encrypted, encryption),
    signed('deltas', null, null),
  ],
};
await writeFile(
  new URL('../fixtures/artifacts-v3.json', import.meta.url),
  JSON.stringify(fixture, null, 2) + '\n',
);
