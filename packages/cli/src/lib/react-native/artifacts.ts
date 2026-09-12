import { createDecipheriv, createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import yauzl from 'yauzl';
import {
  assertDescriptor,
  hashInventory,
  hermesBytecodeVersion,
  parseRNInventory,
  type DeltaFileEntry,
  type RNDescriptor,
} from '@otakit/rn-protocol';
import { deriveKid, type BundleEncryptionParams } from '../crypto.js';

export const MAX_RN_PAYLOAD = 100 * 1024 * 1024;
export interface SourceMapping {
  source: string;
  destination: string;
}

export async function collectRNFiles(root: string): Promise<DeltaFileEntry[]> {
  const files: DeltaFileEntry[] = [];
  let totalSize = 0;
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`RN payload cannot contain symlinks: ${absolute}`);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        if (entry.name.endsWith('.map'))
          throw new Error(`Keep source maps outside the RN payload: ${absolute}`);
        const size = (await lstat(absolute)).size;
        totalSize += size;
        if (totalSize > MAX_RN_PAYLOAD) throw new Error('RN file exceeds payload limit');
        const bytes = await readFile(absolute);
        files.push({
          path: relative(root, absolute).split(sep).join('/'),
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
        if (files.length > 5000) throw new Error('RN payload exceeds file count limit');
      } else throw new Error(`Unsupported RN payload entry: ${absolute}`);
    }
  }
  if (!(await lstat(root)).isDirectory())
    throw new Error('RN payload root must be a real directory');
  await walk(root);
  const parsed = parseRNInventory(files, MAX_RN_PAYLOAD);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.files;
}

/** Check the complete mapping before the first destination is created. */
export async function copyRNMapping(mapping: SourceMapping[], destination: string): Promise<void> {
  const unique = new Map<string, SourceMapping & { bytes: Buffer }>();
  let total = 0;
  for (const entry of mapping) {
    if (['index.bundle', 'otakit-bundle.json'].includes(entry.destination))
      throw new Error(`RN asset collides with generated entry: ${entry.destination}`);
    const source = await realpath(entry.source);
    const previous = unique.get(entry.destination);
    if (previous && previous.source !== source)
      throw new Error(
        `RN asset destination ${entry.destination} collides: ${previous.source} and ${source}`,
      );
    if (previous) continue;
    const info = await lstat(source);
    if (!info.isFile()) throw new Error(`RN asset is not a regular file: ${source}`);
    if (info.size > MAX_RN_PAYLOAD - total || unique.size >= 4998)
      throw new Error('RN assets exceed payload limits');
    const bytes = await readFile(source);
    total += bytes.length;
    if (total > MAX_RN_PAYLOAD) throw new Error('RN assets exceed payload limits');
    unique.set(entry.destination, { source, destination: entry.destination, bytes });
  }
  const files = [...unique.values()].map((entry) => ({
    path: entry.destination,
    size: entry.bytes.length,
    sha256: createHash('sha256').update(entry.bytes).digest('hex'),
  }));
  for (const required of ['index.bundle', 'otakit-bundle.json']) {
    const placeholder = Buffer.from('otakit-mapping-placeholder');
    files.push({
      path: required,
      size: placeholder.length,
      sha256: createHash('sha256').update(placeholder).digest('hex'),
    });
  }
  const parsed = parseRNInventory(files, MAX_RN_PAYLOAD);
  if (!parsed.ok) throw new Error(parsed.error);
  await mkdir(destination, { recursive: true });
  if (!(await lstat(destination)).isDirectory() || (await readdir(destination)).length !== 0)
    throw new Error('RN asset destination must be an empty real directory');
  const root = await realpath(destination);
  for (const entry of unique.values()) {
    const target = resolve(root, entry.destination);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.bytes, { flag: 'wx' });
  }
}

export async function verifyRNDirectory(
  root: string,
  expected: RNDescriptor,
  bytecodeVersion: number,
) {
  assertDescriptor(expected);
  const descriptor = JSON.parse(await readFile(join(root, 'otakit-bundle.json'), 'utf8'));
  assertDescriptor(descriptor);
  for (const key of ['platform', 'runtimeVersion', 'version', 'reactNativeVersion'] as const)
    if (descriptor[key] !== expected[key])
      throw new Error(`RN descriptor ${key} differs from the selected native build`);
  if (hermesBytecodeVersion(await readFile(join(root, 'index.bundle'))) !== bytecodeVersion)
    throw new Error('Hermes bytecode format differs from the native build');
  if (descriptor.expo) {
    const config = await readFile(join(root, 'expo-config.json'));
    if (config.length > 256 * 1024) throw new Error('Expo public config exceeds 256 KiB');
    const json = JSON.parse(config.toString('utf8'));
    if (!json || typeof json !== 'object' || Array.isArray(json))
      throw new Error('Invalid Expo public config');
    if (descriptor.expo.domRoot && !(await lstat(join(root, 'www.bundle'))).isDirectory())
      throw new Error('Missing Expo DOM output');
  }
  const files = await collectRNFiles(root);
  return { files, contentHash: hashInventory(files) };
}

export async function archiveRNDirectory(
  root: string,
  output: string,
  files: DeltaFileEntry[],
): Promise<void> {
  const archive = new yazl.ZipFile();
  const stream = createWriteStream(output, { flags: 'wx', mode: 0o600 });
  const complete = pipeline(archive.outputStream, stream);
  try {
    for (const file of files
      .slice()
      .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))) {
      const bytes = await readFile(join(root, file.path));
      if (
        bytes.length !== file.size ||
        createHash('sha256').update(bytes).digest('hex') !== file.sha256
      )
        throw new Error(`RN export changed before archiving: ${file.path}`);
      archive.addBuffer(bytes, file.path, {
        mtime: new Date('1980-01-01T00:00:00Z'),
        mode: 0o100644,
      });
    }
    archive.end();
    await complete;
  } catch (error) {
    stream.destroy(error as Error);
    await complete.catch(() => undefined);
    throw error;
  }
}

function decodeBase64(value: string, size: number): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (
    bytes.length !== size ||
    bytes.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')
  )
    throw new Error('Malformed RN encryption envelope');
  return bytes;
}

/** Authenticates before exposing any decrypted archive bytes. No fallback/key substitution. */
export function decryptRNArchive(
  bytes: Buffer,
  envelope: BundleEncryptionParams,
  key: Buffer,
): Buffer {
  if (envelope.alg !== 'AES-256-GCM' || deriveKid(key) !== envelope.kid || bytes.length < 16)
    throw new Error('RN baseline encryption policy/key mismatch');
  const wrapped = decodeBase64(envelope.wrappedDek, 48);
  const unwrap = createDecipheriv('aes-256-gcm', key, decodeBase64(envelope.wrapNonce, 12));
  unwrap.setAuthTag(wrapped.subarray(32));
  const dek = Buffer.concat([unwrap.update(wrapped.subarray(0, 32)), unwrap.final()]);
  const cipher = createDecipheriv('aes-256-gcm', dek, decodeBase64(envelope.nonce, 12));
  cipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([cipher.update(bytes.subarray(0, -16)), cipher.final()]);
}

/** Inspect ZIP contents without extracting paths or trusting archive declarations. */
export async function verifyRNArchive(
  bytes: Buffer,
  expected: DeltaFileEntry[],
  collect?: (file: DeltaFileEntry, bytes: Buffer) => void,
): Promise<void> {
  const parsed = parseRNInventory(expected, MAX_RN_PAYLOAD);
  if (!parsed.ok || bytes.length > MAX_RN_PAYLOAD)
    throw new Error('Invalid RN archive inventory or size');
  const declared = new Map(expected.map((file) => [file.path, file]));
  await new Promise<void>((resolvePromise, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(error ?? new Error('Invalid RN ZIP'));
          return;
        }
        const seen = new Set<string>();
        const fail = (failure: unknown) => {
          zip.close();
          reject(failure);
        };
        zip.on('error', fail);
        zip.on('entry', (entry: yauzl.Entry) => {
          const declaredFile = declared.get(entry.fileName);
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (
            !declaredFile ||
            seen.has(entry.fileName) ||
            (mode !== 0 && mode !== 0o100000) ||
            entry.uncompressedSize !== declaredFile.size ||
            (entry.generalPurposeBitFlag & 1) !== 0
          ) {
            fail(new Error(`Unexpected, duplicate or non-regular RN ZIP entry: ${entry.fileName}`));
            return;
          }
          seen.add(entry.fileName);
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail(streamError);
              return;
            }
            const hash = createHash('sha256');
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on('error', fail);
            stream.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > declaredFile.size) stream.destroy(new Error('RN ZIP size exceeded'));
              else {
                hash.update(chunk);
                if (collect) chunks.push(chunk);
              }
            });
            stream.on('end', () => {
              if (size !== declaredFile.size || hash.digest('hex') !== declaredFile.sha256) {
                fail(new Error(`RN ZIP content mismatch: ${entry.fileName}`));
                return;
              }
              try {
                collect?.(declaredFile, Buffer.concat(chunks, size));
              } catch (error) {
                fail(error);
                return;
              }
              zip.readEntry();
            });
          });
        });
        zip.on('end', () => {
          if (seen.size !== declared.size) reject(new Error('RN ZIP is missing declared files'));
          else resolvePromise();
        });
        zip.readEntry();
      },
    );
  });
}

export async function readRNArchive(bytes: Buffer, expected: DeltaFileEntry[]) {
  const files = new Map<string, Buffer>();
  await verifyRNArchive(bytes, expected, (file, content) => files.set(file.sha256, content));
  return files;
}
