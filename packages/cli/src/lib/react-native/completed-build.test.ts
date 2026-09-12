import { createHash, generateKeyPairSync } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import yazl from 'yazl';
import {
  canonicalJSON,
  hashInventory,
  rnCaseFoldingJSON,
  type RNDescriptor,
} from '@otakit/rn-protocol';
import { archiveRNDirectory, verifyRNDirectory } from './artifacts.js';
import { hashBuffer } from '../hash.js';
import { type NativeBuildInputs, type NativeBuildRecord } from './build-record.js';
import {
  embeddedBuildId,
  readEmbeddedExport,
  type EmbeddedExportReceipt,
} from './export-receipt.js';
import {
  assertCompletedBuild,
  assertOutputOutside,
  sealNativeBuild,
  verifyCompletedBaseline,
} from './completed-build.js';
import { verifyNativePackage } from './native-package.js';
import { exportRN } from './export.js';
import { stageEmbedded } from './stage-embedded.js';
import { hostConfigurationHash, parseHostConfiguration } from './host-configuration.js';

const hostSettings = {
  cdnURL: 'https://cdn.example.test',
  ingestURL: 'https://ingest.example.test/v1',
  channel: null,
  publicKeys: {
    test: generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .publicKey.export({ type: 'spki', format: 'der' })
      .toString('base64'),
  },
  bundleKeys: {},
};

const mock = vi.hoisted(() => ({ capture: vi.fn(), exec: vi.fn() }));
vi.mock('./build-record.js', async (original) => ({
  ...(await original<object>()),
  captureNativeBuild: mock.capture,
}));
vi.mock('node:child_process', async (original) => ({
  ...(await original<object>()),
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: mock.exec }),
}));
let root: string;
let directory: string;
let build: NativeBuildRecord;
let receipt: EmbeddedExportReceipt;
let entries: Map<string, Buffer>;
const inputs = {} as NativeBuildInputs;
beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(join(tmpdir(), 'otakit-completed-build-'));
  directory = join(root, 'embedded');
  await mkdir(join(directory, 'payload'), { recursive: true });
  await mkdir(join(directory, 'private'));
  const identity: NativeBuildRecord['identity'] = {
    appId: 'app',
    platform: 'android',
    nativeApplicationId: 'com.example.app',
    variant: 'release',
    reactNativeVersion: '0.86.3',
    protocolVersion: 1,
    fingerprintTool: '@expo/fingerprint@0.20.6',
    fingerprintHash: 'fixture',
    fingerprintSources: [],
    autolinking: {},
    hermesCompiler: { path: 'hermesc', sha256: 'a'.repeat(64), bytecodeVersion: 98 },
    nativeFiles: [{ path: 'native.gradle', sha256: 'b'.repeat(64) }],
    nativeConfiguration: { otakitResourceDirectory: 'OtaKit' },
    hostConfigurationHash: hostConfigurationHash(hostSettings),
  };
  build = {
    format: 'otakit-rn-native-build',
    version: 1,
    identity,
    runtimeVersion: createHash('sha256').update(canonicalJSON(identity)).digest('base64url'),
  };
  const descriptor: RNDescriptor = {
    format: 'otakit-rn',
    formatVersion: 1,
    framework: 'react-native',
    platform: 'android',
    runtimeVersion: build.runtimeVersion,
    version: 'embedded-1',
    entryPoint: 'index.bundle',
    engine: 'hermes',
    bundleFormat: 'hermes-bytecode',
    reactNativeVersion: '0.86.3',
  };
  const bytecode = Buffer.alloc(16);
  Buffer.from('c61fbc03c103191f', 'hex').copy(bytecode);
  bytecode.writeUInt32LE(98, 8);
  await writeFile(join(directory, 'payload/index.bundle'), bytecode);
  await writeFile(join(directory, 'payload/otakit-bundle.json'), JSON.stringify(descriptor));
  const verified = await verifyRNDirectory(join(directory, 'payload'), descriptor, 98);
  await archiveRNDirectory(
    join(directory, 'payload'),
    join(directory, 'artifact.zip'),
    verified.files,
  );
  receipt = {
    format: 'otakit-rn-export',
    version: 1,
    purpose: 'embedded',
    nativeBuildId: '',
    appId: 'app',
    platform: 'android',
    runtimeVersion: build.runtimeVersion,
    displayVersion: 'embedded-1',
    contentHash: verified.contentHash,
    files: verified.files,
    sha256: hashBuffer(await readFile(join(directory, 'artifact.zip'))),
    embeddedReceipt: {
      appId: 'app',
      framework: 'react-native',
      platform: 'android',
      runtimeVersion: build.runtimeVersion,
      version: 'embedded-1',
      embeddedContentHash: verified.contentHash,
    },
    sourceMap: 'private/index.map',
    archive: 'artifact.zip',
    payload: 'payload',
    mappingHash: 'c'.repeat(64),
  };
  receipt.nativeBuildId = embeddedBuildId(receipt.embeddedReceipt);
  await writeFile(join(directory, 'export.json'), JSON.stringify(receipt));
  await writeFile(join(directory, 'otakit-embedded.json'), JSON.stringify(receipt.embeddedReceipt));
  await writeFile(join(directory, 'private/native-build.json'), JSON.stringify(build));
  await writeFile(join(root, 'host.json'), JSON.stringify(hostSettings));
  entries = new Map([
    ['classes.dex', Buffer.from('compiled fixture')],
    ['lib/arm64-v8a/libhermesvm.so', Buffer.from('native fixture')],
    ['assets/OtaKit/payload/index.bundle', bytecode],
    ['assets/OtaKit/payload/otakit-bundle.json', Buffer.from(JSON.stringify(descriptor))],
    ['assets/OtaKit/otakit-embedded.json', Buffer.from(JSON.stringify(receipt.embeddedReceipt))],
    ['assets/OtaKit/case-folding.json', Buffer.from(rnCaseFoldingJSON)],
    [
      'assets/OtaKit/configuration.json',
      Buffer.from(
        JSON.stringify({
          ...hostSettings,
          nativeBuildId: embeddedBuildId(receipt.embeddedReceipt),
          embeddedReceipt: receipt.embeddedReceipt,
          reactNativeVersion: '0.86.3',
          hermesBytecodeVersion: 98,
        }),
      ),
    ],
  ]);
  mock.capture.mockResolvedValue(build);
  mock.exec.mockResolvedValue({ stdout: "package: name='com.example.app' versionCode='1'\n" });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function apk(duplicate = false) {
  const zip = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  const ready = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
  for (const [path, bytes] of entries) zip.addBuffer(bytes, path, { mode: 0o100644 });
  if (duplicate) zip.addBuffer(Buffer.from('shadowed'), 'assets/OtaKit/payload/index.bundle');
  zip.end();
  const path = join(root, 'application.apk');
  await writeFile(path, await ready);
  return path;
}
async function seal(binary: string) {
  return sealNativeBuild({
    project: root,
    nativeInputs: inputs,
    embeddedExport: directory,
    binary,
    receiptPath: join(root, 'completed.json'),
    aapt2: '/installed/aapt2',
  });
}

it('seals exact packaged bytes, reuses an identical receipt and refuses a different binary', async () => {
  const binary = await apk();
  const completed = await seal(binary);
  expect(completed.binary.sha256).toBe(hashBuffer(await readFile(binary)));
  await expect(seal(binary)).resolves.toEqual(completed);
  await expect(verifyCompletedBaseline(completed, directory)).resolves.toMatchObject({ receipt });
  entries.set('classes.dex', Buffer.from('different compiled application'));
  await apk();
  await expect(seal(binary)).rejects.toThrow('different binary');
  expect(JSON.parse(await readFile(join(root, 'completed.json'), 'utf8'))).toEqual(completed);
});

it.each([
  'payload',
  'extra-payload',
  'receipt',
  'configuration',
  'private-file',
  'missing-receipt',
  'missing-unicode',
  'changed-unicode',
  'host-settings',
])('rejects packaged %s changes before creating a completed receipt', async (change) => {
  if (change === 'payload')
    entries.set('assets/OtaKit/payload/index.bundle', Buffer.from('changed'));
  if (change === 'extra-payload')
    entries.set('assets/OtaKit/payload/extra.js', Buffer.from('extra'));
  if (change === 'receipt') entries.set('assets/OtaKit/otakit-embedded.json', Buffer.from('{}'));
  if (change === 'configuration')
    entries.set('assets/OtaKit/configuration.json', Buffer.from('{}'));
  if (change === 'private-file')
    entries.set('assets/OtaKit/private/index.map', Buffer.from('private'));
  if (change === 'missing-receipt') entries.delete('assets/OtaKit/otakit-embedded.json');
  if (change === 'missing-unicode') entries.delete('assets/OtaKit/case-folding.json');
  if (change === 'changed-unicode')
    entries.set('assets/OtaKit/case-folding.json', Buffer.from('{}'));
  if (change === 'host-settings') {
    const config = JSON.parse(entries.get('assets/OtaKit/configuration.json')!.toString());
    config.publicKeys = { another: hostSettings.publicKeys.test };
    entries.set('assets/OtaKit/configuration.json', Buffer.from(JSON.stringify(config)));
  }
  await expect(seal(await apk())).rejects.toThrow();
  await expect(readFile(join(root, 'completed.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects duplicate APK entries and a native ID returned by the platform parser that differs', async () => {
  await expect(seal(await apk(true))).rejects.toThrow('duplicate');
  mock.exec.mockResolvedValue({ stdout: "package: name='com.other.app'\n" });
  await expect(seal(await apk())).rejects.toThrow('application ID');
});

it('rejects inputs changed after binary verification and never writes a completed receipt', async () => {
  mock.capture
    .mockResolvedValueOnce(build)
    .mockResolvedValueOnce({ ...build, runtimeVersion: 'changed' });
  await expect(seal(await apk())).rejects.toThrow('Native inputs differ');
  await expect(readFile(join(root, 'completed.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects corrupt baseline transport and mismatched completed baseline receipts', async () => {
  const completed = await seal(await apk());
  await expect(
    verifyCompletedBaseline(
      { ...completed, baseline: { ...receipt, displayVersion: 'other' } },
      directory,
    ),
  ).rejects.toThrow('Archived baseline differs');
  await writeFile(join(directory, 'artifact.zip'), 'corrupt archive');
  await expect(readEmbeddedExport(directory)).rejects.toThrow('transport hash');
});

it('does not accept prepared inputs as a completed build or begin Metro for them', async () => {
  expect(() => assertCompletedBuild(build)).toThrow('completed native build');
  mock.capture.mockClear();
  await expect(
    exportRN({
      project: root,
      nativeInputs: inputs,
      entry: 'index.js',
      output: join(root, 'ota'),
      version: 'ota-1',
      purpose: 'ota',
      completedBuild: build as never,
      baselineExport: directory,
    }),
  ).rejects.toThrow('completed native build');
  expect(mock.capture).not.toHaveBeenCalled();
});

it('keeps new outputs outside immutable inputs, including paths through symlinked parents', async () => {
  await expect(assertOutputOutside(directory, join(directory, 'new/output'))).rejects.toThrow(
    'outside',
  );
  const alias = join(root, 'alias');
  await symlink(directory, alias);
  await expect(assertOutputOutside(directory, join(alias, 'new/output'))).rejects.toThrow(
    'outside',
  );
  await expect(
    assertOutputOutside(directory, join(root, 'separate/output')),
  ).resolves.toBeUndefined();
  await expect(
    sealNativeBuild({
      project: root,
      nativeInputs: inputs,
      embeddedExport: directory,
      binary: directory,
      receiptPath: join(alias, 'completed.json'),
    }),
  ).rejects.toThrow('outside');
  await expect(readFile(join(directory, 'completed.json.lock'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

it('rejects native package changes while the platform manifest is being inspected', async () => {
  const binary = await apk();
  mock.exec.mockImplementation(async () => {
    await writeFile(binary, 'replaced during inspection');
    return { stdout: "package: name='com.example.app'\n" };
  });
  await expect(
    verifyNativePackage({
      binary,
      nativeBuild: build,
      baseline: receipt,
      aapt2: '/installed/aapt2',
    }),
  ).rejects.toThrow('changed during verification');
});

it.each([0, 1, 2])(
  'verifies iOS resources with Xcode provenance=%s and preserves legacy checks',
  async (xcodeBuild) => {
    build.identity.platform = 'ios';
    build.identity.nativeConfiguration.iosBuild = {
      ...(xcodeBuild ? { format: 'otakit-rn-xcode-build', version: xcodeBuild } : {}),
      ...(xcodeBuild === 2
        ? { bundleVersions: { CFBundleVersion: '7', CFBundleShortVersionString: '1.2' } }
        : {}),
      CURRENT_PROJECT_VERSION: '7',
      MARKETING_VERSION: xcodeBuild === 2 ? '1.0' : '1.2',
    };
    build.runtimeVersion = createHash('sha256')
      .update(canonicalJSON(build.identity))
      .digest('base64url');
    const descriptor = JSON.parse(
      await readFile(join(directory, 'payload/otakit-bundle.json'), 'utf8'),
    );
    descriptor.platform = 'ios';
    descriptor.runtimeVersion = build.runtimeVersion;
    await writeFile(join(directory, 'payload/otakit-bundle.json'), JSON.stringify(descriptor));
    const verified = await verifyRNDirectory(join(directory, 'payload'), descriptor, 98);
    receipt = {
      ...receipt,
      platform: 'ios',
      runtimeVersion: build.runtimeVersion,
      ...verified,
      embeddedReceipt: {
        ...receipt.embeddedReceipt,
        platform: 'ios',
        runtimeVersion: build.runtimeVersion,
        embeddedContentHash: verified.contentHash,
      },
    };
    const app = join(root, 'Application.app');
    receipt.nativeBuildId = embeddedBuildId(receipt.embeddedReceipt);
    const resources = join(app, 'OtaKit');
    await mkdir(resources, { recursive: true });
    await cp(join(directory, 'payload'), join(resources, 'payload'), { recursive: true });
    await writeFile(
      join(resources, 'otakit-embedded.json'),
      JSON.stringify(receipt.embeddedReceipt),
    );
    await writeFile(
      join(resources, 'configuration.json'),
      JSON.stringify({
        ...hostSettings,
        embeddedReceipt: receipt.embeddedReceipt,
        nativeBuildId: embeddedBuildId(receipt.embeddedReceipt),
        reactNativeVersion: '0.86.3',
        hermesBytecodeVersion: 98,
      }),
    );
    await writeFile(join(resources, 'case-folding.json'), rnCaseFoldingJSON);
    await writeFile(join(app, 'Application'), Buffer.alloc(64, 1));
    const plist = {
      CFBundleIdentifier: 'com.example.app',
      CFBundlePackageType: 'APPL',
      CFBundleExecutable: 'Application',
      CFBundleVersion: '7',
      CFBundleShortVersionString: '1.2',
    };
    await writeFile(join(app, 'Info.plist'), JSON.stringify(plist));
    mock.exec.mockResolvedValue({ stdout: JSON.stringify(plist) });
    const options = { binary: app, nativeBuild: build, baseline: receipt };
    const verifiedApp = await verifyNativePackage(options);
    expect(verifiedApp).toMatchObject({
      format: 'ios-app',
      nativeApplicationId: 'com.example.app',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    mock.exec.mockResolvedValue({ stdout: JSON.stringify({ ...plist, CFBundleVersion: '6' }) });
    if (xcodeBuild)
      await expect(verifyNativePackage(options)).rejects.toThrow('CFBundleVersion differs');
    else await expect(verifyNativePackage(options)).resolves.toMatchObject({ format: 'ios-app' });
    mock.exec.mockResolvedValue({ stdout: JSON.stringify(plist) });
    await writeFile(join(resources, 'payload/index.bundle'), 'tampered');
    await expect(verifyNativePackage(options)).rejects.toThrow('payload differs');
    await rm(join(resources, 'payload/index.bundle'));
    await symlink(join(directory, 'payload/index.bundle'), join(resources, 'payload/index.bundle'));
    await expect(verifyNativePackage(options)).rejects.toThrow('unsupported link');
  },
);

it.each(['android', 'ios'] as const)(
  'seals the exact separate Expo DOM copy on %s',
  async (platform) => {
    build.identity.platform = platform;
    build.runtimeVersion = createHash('sha256')
      .update(canonicalJSON(build.identity))
      .digest('base64url');
    const descriptor = JSON.parse(
      entries.get('assets/OtaKit/payload/otakit-bundle.json')!.toString(),
    );
    Object.assign(descriptor, {
      platform,
      runtimeVersion: build.runtimeVersion,
      expo: { configFile: 'expo-config.json', domRoot: 'www.bundle' },
    });
    entries.set(
      'assets/OtaKit/payload/otakit-bundle.json',
      Buffer.from(JSON.stringify(descriptor)),
    );
    entries.set('assets/OtaKit/payload/expo-config.json', Buffer.from('{}'));
    const html = Buffer.from('<h1>Verified DOM</h1>');
    entries.set('assets/OtaKit/payload/www.bundle/index.html', html);
    receipt.platform = platform;
    receipt.runtimeVersion = build.runtimeVersion;
    receipt.files = [...entries]
      .filter(([path]) => path.startsWith('assets/OtaKit/payload/'))
      .map(([path, bytes]) => ({
        path: path.slice('assets/OtaKit/payload/'.length),
        size: bytes.length,
        sha256: hashBuffer(bytes),
      }));
    receipt.contentHash = hashInventory(receipt.files);
    receipt.embeddedReceipt = {
      ...receipt.embeddedReceipt,
      platform,
      runtimeVersion: build.runtimeVersion,
      embeddedContentHash: receipt.contentHash,
    };
    entries.set(
      'assets/OtaKit/otakit-embedded.json',
      Buffer.from(JSON.stringify(receipt.embeddedReceipt)),
    );
    entries.set(
      'assets/OtaKit/configuration.json',
      Buffer.from(
        JSON.stringify({
          ...hostSettings,
          embeddedReceipt: receipt.embeddedReceipt,
          nativeBuildId: embeddedBuildId(receipt.embeddedReceipt),
          reactNativeVersion: '0.86.3',
          hermesBytecodeVersion: 98,
        }),
      ),
    );
    async function verify() {
      let binary;
      if (platform === 'android') binary = await apk();
      else {
        binary = join(root, 'Expo.app');
        await rm(binary, { recursive: true, force: true });
        await mkdir(binary);
        for (const [path, bytes] of entries) {
          if (!path.startsWith('assets/')) continue;
          const output = join(binary, path.slice('assets/'.length));
          await mkdir(dirname(output), { recursive: true });
          await writeFile(output, bytes);
        }
        const plist = {
          CFBundleIdentifier: 'com.example.app',
          CFBundlePackageType: 'APPL',
          CFBundleExecutable: 'Expo',
        };
        await writeFile(join(binary, 'Info.plist'), JSON.stringify(plist));
        await writeFile(join(binary, 'Expo'), Buffer.alloc(64, 1));
        mock.exec.mockResolvedValue({ stdout: JSON.stringify(plist) });
      }
      return verifyNativePackage({
        binary,
        nativeBuild: build,
        baseline: receipt,
        aapt2: '/installed/aapt2',
      });
    }
    await expect(verify()).rejects.toThrow('Expo DOM resources differ');
    entries.set('assets/www.bundle/index.html', html);
    await expect(verify()).resolves.toMatchObject({ nativeApplicationId: 'com.example.app' });
    entries.set('assets/www.bundle/index.html', Buffer.from('<h1>Stale DOM</h1>'));
    await expect(verify()).rejects.toThrow('Expo DOM resources differ');
    entries.set('assets/www.bundle/index.html', html);
    entries.set('assets/www.bundle/previous-build.js', Buffer.from('stale'));
    await expect(verify()).rejects.toThrow('Expo DOM resources differ');
  },
);

it('stages only verified public resources, reuses an exact output and seals the staged APK', async () => {
  const output = join(root, 'generated/OtaKit');
  const options = { embeddedExport: directory, configuration: join(root, 'host.json'), output };
  const staged = await stageEmbedded(options);
  await expect(stageEmbedded(options)).resolves.toEqual(staged);
  await expect(readFile(join(output, 'private/index.map'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(JSON.parse(await readFile(join(output, 'configuration.json'), 'utf8'))).toEqual({
    ...hostSettings,
    embeddedReceipt: receipt.embeddedReceipt,
    nativeBuildId: receipt.nativeBuildId,
    reactNativeVersion: '0.86.3',
    hermesBytecodeVersion: 98,
  });
  for (const path of entries.keys()) {
    if (path.startsWith('assets/OtaKit/'))
      entries.set(path, await readFile(join(output, path.slice('assets/OtaKit/'.length))));
  }
  await expect(seal(await apk())).resolves.toMatchObject({ baseline: receipt });
  await writeFile(join(output, 'payload/stale.png'), 'old asset');
  await expect(stageEmbedded(options)).rejects.toThrow('differ');
  expect(await readFile(join(output, 'payload/stale.png'), 'utf8')).toBe('old asset');
});

it('refuses unbound settings, mismatched folder names and corrupt exports without publishing resources', async () => {
  const output = join(root, 'generated/OtaKit');
  const options = { embeddedExport: directory, configuration: join(root, 'host.json'), output };
  await writeFile(options.configuration, JSON.stringify({ ...hostSettings, channel: 'other' }));
  await expect(stageEmbedded(options)).rejects.toThrow('recorded');
  await writeFile(options.configuration, JSON.stringify(hostSettings));
  await expect(stageEmbedded({ ...options, output: join(root, 'Wrong') })).rejects.toThrow(
    'folder',
  );
  await writeFile(join(directory, 'artifact.zip'), 'corrupt');
  await expect(stageEmbedded(options)).rejects.toThrow('transport hash');
  await expect(readFile(join(output, 'configuration.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

it('rejects resource symlinks and output paths inside the archived export', async () => {
  const output = join(root, 'generated/OtaKit');
  const options = { embeddedExport: directory, configuration: join(root, 'host.json'), output };
  await stageEmbedded(options);
  await rm(join(output, 'case-folding.json'));
  await symlink(join(root, 'host.json'), join(output, 'case-folding.json'));
  await expect(stageEmbedded(options)).rejects.toThrow('differ');
  await expect(stageEmbedded({ ...options, output: join(directory, 'OtaKit') })).rejects.toThrow(
    'outside',
  );
});

it('validates native host settings before generating resources', () => {
  const parse = (extra: object) =>
    parseHostConfiguration(Buffer.from(JSON.stringify({ ...hostSettings, ...extra })));
  expect(parse({})).toEqual(hostSettings);
  expect(() => parse({ embeddedReceipt: {} })).toThrow('generated');
  expect(() => parse({ cdnURL: 'http://example.test' })).toThrow('cdnURL');
  expect(() => parse({ ingestURL: 'https://example.test/v1?token=secret' })).toThrow('ingestURL');
  expect(() => parse({ publicKeys: {} })).toThrow('trusted key');
  expect(() => parse({ bundleKeys: { key: 'eA==' } })).toThrow('32 bytes');
  expect(parse({ cdnURL: 'http://127.0.0.1:9042', allowLocalhost: true })).toHaveProperty(
    'allowLocalhost',
    true,
  );
});
