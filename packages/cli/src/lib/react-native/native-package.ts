import { execFile } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import { canonicalJSON, type DeltaFileEntry } from '@otakit/rn-protocol';
import { createHash } from 'node:crypto';
import { hashBuffer, hashFile } from '../hash.js';
import { embeddedBuildId, type EmbeddedExportReceipt } from './export-receipt.js';
import type { NativeBuildRecord } from './build-record.js';

export interface NativePackageIdentity {
  format: 'android-apk' | 'ios-app';
  sha256: string;
  nativeApplicationId: string;
}
const MAX_NATIVE_PACKAGE = 2 * 1024 * 1024 * 1024;
const MAX_RESOURCE_JSON = 1024 * 1024;
type PackageFiles = Map<string, { size: number; sha256: string }>;

async function snapshotApp(root: string): Promise<PackageFiles> {
  const files: PackageFiles = new Map();
  let total = 0;
  async function walk(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isDirectory()) {
      for (const name of await readdir(path)) await walk(join(path, name));
    } else if (info.isFile()) {
      total += info.size;
      if (total > MAX_NATIVE_PACKAGE || files.size >= 50_000)
        throw new Error('Native app exceeds verification limits');
      files.set(relative(root, path).split(sep).join('/'), {
        size: info.size,
        sha256: await hashFile(path),
      });
    } else throw new Error(`Native app contains an unsupported link or special file: ${path}`);
  }
  if (!(await lstat(root)).isDirectory())
    throw new Error('Expected a completed iOS .app directory');
  await walk(root);
  return files;
}
function appHash(files: PackageFiles): string {
  return hashBuffer(
    Buffer.from(canonicalJSON([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))),
  );
}

async function inspectAPK(path: string, resourceRoot: string) {
  const files: PackageFiles = new Map();
  const json = new Map<string, Buffer>();
  await new Promise<void>((done, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(error ?? new Error('Invalid APK'));
          return;
        }
        let total = 0;
        let count = 0;
        const names = new Set<string>();
        const fail = (error: unknown) => {
          zip.close();
          reject(error);
        };
        zip.on('error', fail);
        zip.on('entry', (entry: yauzl.Entry) => {
          total += entry.uncompressedSize;
          if (++count > 50_000 || total > MAX_NATIVE_PACKAGE || names.has(entry.fileName)) {
            fail(new Error('APK exceeds verification limits or contains duplicate entries'));
            return;
          }
          names.add(entry.fileName);
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (entry.fileName.endsWith('/')) {
            if (entry.uncompressedSize !== 0 || (mode !== 0 && mode !== 0o040000)) {
              fail(new Error('Invalid APK directory'));
              return;
            }
            zip.readEntry();
            return;
          }
          if ((mode !== 0 && mode !== 0o100000) || (entry.generalPurposeBitFlag & 1) !== 0) {
            fail(new Error('APK contains an encrypted or non-regular entry'));
            return;
          }
          // Hash all entries, not just OtaKit assets. The whole APK is separately pinned as well.
          const retain =
            entry.fileName === `${resourceRoot}/otakit-embedded.json` ||
            entry.fileName === `${resourceRoot}/configuration.json`;
          if (retain && entry.uncompressedSize > MAX_RESOURCE_JSON) {
            fail(new Error('Native receipt/configuration exceeds limit'));
            return;
          }
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) {
              fail(error ?? new Error('Unreadable APK entry'));
              return;
            }
            const hash = createHash('sha256');
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on('error', fail);
            stream.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > entry.uncompressedSize) {
                stream.destroy(new Error('APK entry size exceeded'));
                return;
              }
              hash.update(chunk);
              if (retain) chunks.push(chunk);
            });
            stream.on('end', () => {
              if (size !== entry.uncompressedSize) {
                fail(new Error('APK entry size mismatch'));
                return;
              }
              files.set(entry.fileName, { size, sha256: hash.digest('hex') });
              if (retain) json.set(entry.fileName, Buffer.concat(chunks));
              zip.readEntry();
            });
          });
        });
        zip.on('end', done);
        zip.readEntry();
      },
    );
  });
  if (
    !files.has('classes.dex') ||
    ![...files.keys()].some((name) => /^lib\/[^/]+\/libhermes(?:vm)?\.so$/.test(name))
  )
    throw new Error('APK is missing compiled application or Hermes code');
  return { files, json };
}

/** Checks the actual packaged resources; no extracted directory supplied by the caller is trusted. */
export async function verifyNativePackage(options: {
  binary: string;
  nativeBuild: NativeBuildRecord;
  baseline: EmbeddedExportReceipt;
  aapt2?: string;
}): Promise<NativePackageIdentity> {
  const { binary, nativeBuild, baseline } = options;
  if (
    baseline.platform !== nativeBuild.identity.platform ||
    baseline.appId !== nativeBuild.identity.appId ||
    baseline.runtimeVersion !== nativeBuild.runtimeVersion
  )
    throw new Error('Baseline target differs from the native package build');
  const directory = nativeBuild.identity.nativeConfiguration.otakitResourceDirectory;
  if (typeof directory !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(directory))
    throw new Error(
      'Native inputs must declare otakitResourceDirectory as one resource folder name',
    );
  const android = nativeBuild.identity.platform === 'android';
  const prefix = android ? `assets/${directory}` : directory;
  let files: PackageFiles;
  let sha256: string;
  let nativeApplicationId: string;
  let readResource: (name: string) => Promise<Buffer>;
  if (android) {
    const info = await lstat(binary);
    if (!info.isFile() || info.size > MAX_NATIVE_PACKAGE || !binary.endsWith('.apk'))
      throw new Error('Expected a completed Android APK');
    if (!options.aapt2)
      throw new Error('Select the installed Android build-tools aapt2 to inspect the APK identity');
    sha256 = await hashFile(binary);
    const inspected = await inspectAPK(binary, prefix);
    files = inspected.files;
    readResource = async (name) => {
      const value = inspected.json.get(`${prefix}/${name}`);
      if (!value) throw new Error(`Missing packaged native resource: ${name}`);
      return value;
    };
    // Android's parser reads the binary manifest; a JSON sidecar cannot claim the app ID.
    const { stdout } = await promisify(execFile)(options.aapt2, ['dump', 'badging', binary], {
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    nativeApplicationId = /^package: name='([^']+)'/m.exec(stdout)?.[1] ?? '';
  } else {
    if (!binary.endsWith('.app')) throw new Error('Expected a completed iOS .app directory');
    files = await snapshotApp(binary);
    sha256 = appHash(files);
    readResource = async (name) => {
      const info = files.get(`${prefix}/${name}`);
      if (!info || info.size > MAX_RESOURCE_JSON)
        throw new Error(`Missing or oversized packaged native resource: ${name}`);
      return readFile(join(binary, prefix, name));
    };
    const { stdout } = await promisify(execFile)(
      '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', join(binary, 'Info.plist')],
      { timeout: 30_000, maxBuffer: MAX_RESOURCE_JSON },
    );
    const plist = JSON.parse(stdout);
    nativeApplicationId = plist.CFBundleIdentifier;
    const executable = files.get(plist.CFBundleExecutable);
    if (plist.CFBundlePackageType !== 'APPL' || !executable || executable.size < 32)
      throw new Error('Missing compiled iOS app executable');
  }
  if (nativeApplicationId !== nativeBuild.identity.nativeApplicationId)
    throw new Error('Packaged native application ID differs from the build record');
  for (const path of files.keys()) {
    if (
      path.startsWith(`${prefix}/`) &&
      !path.startsWith(`${prefix}/payload/`) &&
      !['otakit-embedded.json', 'configuration.json', 'case-folding.json'].includes(
        path.slice(prefix.length + 1),
      )
    )
      throw new Error(`Unexpected file in packaged OtaKit resources: ${path}`);
  }
  const actualPayload: DeltaFileEntry[] = [...files]
    .filter(([path]) => path.startsWith(`${prefix}/payload/`))
    .map(([path, value]) => ({ path: path.slice(`${prefix}/payload/`.length), ...value }));
  const sorted = (values: DeltaFileEntry[]) =>
    values.slice().sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  if (canonicalJSON(sorted(actualPayload)) !== canonicalJSON(sorted(baseline.files)))
    throw new Error('Packaged embedded payload differs from its archived baseline');
  const embedded = JSON.parse((await readResource('otakit-embedded.json')).toString('utf8'));
  const config = JSON.parse((await readResource('configuration.json')).toString('utf8'));
  if (
    canonicalJSON(embedded) !== canonicalJSON(baseline.embeddedReceipt) ||
    canonicalJSON(config.embeddedReceipt) !== canonicalJSON(embedded) ||
    config.nativeBuildId !== embeddedBuildId(embedded) ||
    config.reactNativeVersion !== nativeBuild.identity.reactNativeVersion ||
    config.hermesBytecodeVersion !== nativeBuild.identity.hermesCompiler.bytecodeVersion
  )
    throw new Error('Packaged native receipt/configuration differs from the completed export');
  const after = android ? await hashFile(binary) : appHash(await snapshotApp(binary));
  if (after !== sha256) throw new Error('Native package changed during verification');
  return { format: android ? 'android-apk' : 'ios-app', sha256, nativeApplicationId };
}
