// Signed local fault fixtures derived from an archived export, not a publication command.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createCipheriv, createHash, randomBytes, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(new URL('../../packages/cli/package.json', import.meta.url));
const { ZipFile } = require('yazl');
const run = promisify(execFile);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function replaceOnce(source, marker, replacement) {
  assert.equal(source.split(marker).length, 2, `Expected one fixture marker: ${marker}`);
  return source.replace(marker, replacement);
}
function encrypt(key, nonce, bytes) {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  return Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
}

export async function prepareUpdates(directory) {
  const { receipt, embeddedExport } = JSON.parse(await readFile(join(directory, 'fixture.json')));
  assert.equal(receipt.platform, 'android');
  const { hermesCompiler } = JSON.parse(await readFile(join(directory, 'inputs.json')));
  const host = JSON.parse(await readFile(join(directory, 'host.json')));
  const privateKey = await readFile(join(directory, 'fixture-private.pem'));
  const [[kid, encodedKey]] = Object.entries(host.bundleKeys);
  const key = Buffer.from(encodedKey, 'base64');
  const output = join(directory, 'updates');
  await mkdir(output); // Never replace an earlier scenario's signed artifacts.
  const original = await readFile(join(embeddedExport, 'private/index.js'), 'utf8');
  const baseline = new Map();
  for (const file of receipt.files) {
    const bytes = await readFile(join(embeddedExport, 'payload', file.path));
    assert.equal(bytes.length, file.size);
    assert.equal(hash(bytes), file.sha256);
    baseline.set(file.path, bytes);
  }
  const cases = {};
  function signManifest(manifest) {
    const encryption = manifest.encryption;
    const canonical = [
      'MANIFEST:3',
      ...['appId', 'framework', 'platform'].map((key) => `${key}:${manifest[key]}`),
      'channel:null',
      ...[
        'version',
        'sha256',
        'contentHash',
        'size',
        'runtimeVersion',
        'strategy',
        'forceImmediate',
      ].map((key) => `${key}:${manifest[key]}`),
      `encryption:${encryption ? [encryption.alg, encryption.kid, encryption.wrapNonce, encryption.wrappedDek, encryption.nonce].join('|') : 'null'}`,
      `releaseId:${manifest.releaseId}`,
      'kid:fixture',
      `iat:${manifest.signature.iat}`,
      `exp:${manifest.signature.exp}`,
    ].join('\n');
    manifest.signature.sig = sign('sha256', Buffer.from(canonical), privateKey).toString(
      'base64url',
    );
    return manifest;
  }
  for (const version of ['good', 'bad']) {
    const files = new Map(baseline);
    const javascript = replaceOnce(
      original,
      'OTAKIT_EXPO_NATIVE_EMBEDDED',
      `OTAKIT_EXPO_NATIVE_${version.toUpperCase()}`,
    );
    const source = join(output, `${version}.js`);
    const bytecode = join(output, `${version}.bundle`);
    await writeFile(source, javascript);
    await run(hermesCompiler, ['-O', '-emit-binary', '-out', bytecode, source], {
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    files.set('index.bundle', await readFile(bytecode));
    const descriptor = JSON.parse(files.get('otakit-bundle.json'));
    descriptor.version = version;
    files.set('otakit-bundle.json', Buffer.from(JSON.stringify(descriptor) + '\n'));
    const config = JSON.parse(files.get('expo-config.json'));
    config.extra = { ...config.extra, fixtureVersion: version };
    files.set('expo-config.json', Buffer.from(JSON.stringify(config) + '\n'));
    let domScripts = 0;
    let domPages = 0;
    for (const [path, bytes] of files) {
      if (!path.startsWith('www.bundle/')) continue;
      if (path.endsWith('.js') && bytes.includes('OTAKIT_EXPO_DOM_EMBEDDED')) {
        files.set(
          path,
          Buffer.from(
            replaceOnce(
              bytes.toString(),
              'OTAKIT_EXPO_DOM_EMBEDDED',
              `OTAKIT_EXPO_DOM_${version.toUpperCase()}`,
            ),
          ),
        );
        domScripts++;
      }
      if (path.endsWith('.html')) {
        files.set(
          path,
          Buffer.from(
            replaceOnce(
              bytes.toString(),
              '</head>',
              `<meta name="otakit-fixture-version" content="${version}"></head>`,
            ),
          ),
        );
        domPages++;
      }
    }
    assert.equal(domScripts, 1);
    assert.equal(domPages, 1);
    const inventory = [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes) }));
    const contentHash = hash(
      inventory
        .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
        .map((file) => `${file.path}:${file.sha256}`)
        .join('\n'),
    );
    const zip = new ZipFile();
    const chunks = [];
    const finished = new Promise((resolve, reject) => {
      zip.outputStream.on('data', (chunk) => chunks.push(chunk));
      zip.outputStream.on('end', resolve);
      zip.outputStream.on('error', reject);
    });
    for (const [path, bytes] of files) zip.addBuffer(bytes, path, { mode: 0o100644 });
    zip.end();
    await finished;
    let archive = Buffer.concat(chunks);
    let encryption = null;
    if (version === 'good') {
      const dek = randomBytes(32);
      const wrapNonce = randomBytes(12);
      const nonce = randomBytes(12);
      encryption = {
        alg: 'AES-256-GCM',
        kid,
        wrapNonce: wrapNonce.toString('base64'),
        wrappedDek: encrypt(key, wrapNonce, dek).toString('base64'),
        nonce: nonce.toString('base64'),
      };
      archive = encrypt(dek, nonce, archive);
    }
    await writeFile(join(output, `${version}.zip`), archive);
    const now = Math.floor(Date.now() / 1000);
    cases[version] = signManifest({
      schemaVersion: 3,
      appId: receipt.appId,
      framework: 'react-native',
      platform: 'android',
      channel: null,
      version,
      sha256: hash(archive),
      contentHash,
      size: archive.length,
      runtimeVersion: receipt.runtimeVersion,
      strategy: 'zip',
      forceImmediate: false,
      encryption,
      releaseId: `expo-${version}`,
      url: `http://127.0.0.1:9042/${version}.zip`,
      signature: { kid: 'fixture', iat: now, exp: now + 3600 },
    });
  }
  const archive = await readFile(join(embeddedExport, receipt.archive));
  assert.equal(hash(archive), receipt.sha256);
  cases.baseline = signManifest({
    ...cases.good,
    version: receipt.embeddedReceipt.version,
    contentHash: receipt.embeddedReceipt.embeddedContentHash,
    sha256: hash(archive),
    size: archive.length,
    encryption: null,
    releaseId: 'expo-baseline',
    url: 'http://127.0.0.1:9042/must-not-download-baseline.zip',
    signature: { ...cases.good.signature },
  });
  await writeFile(join(output, 'cases.json'), JSON.stringify(cases, null, 2));
}
