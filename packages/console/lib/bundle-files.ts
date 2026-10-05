import { getObjectRange, getTextObject } from '@/lib/storage';

/**
 * The files inside an uploaded bundle, for comparing bundles. Delta bundles
 * already store their file list; a zip bundle's list comes from the archive's
 * central directory, read with two range requests and no file data.
 */

export type BundleFile = {
  path: string;
  /** Uncompressed size in bytes. */
  size: number;
  /** sha256 (delta bundles) or CRC-32 (zip bundles), lowercase hex. */
  hash: string;
};

export type BundleFileList = { hashType: 'sha256' | 'crc32'; files: BundleFile[] };

export type BundleFileListResult =
  | { ok: true; list: BundleFileList }
  | { ok: false; reason: 'encrypted' | 'unreadable' };

/** Reads bytes [start, end] (inclusive) of the archive. */
export type RangeReader = (start: number, end: number) => Promise<Buffer>;

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_EOCD_SIZE = 56;
const ZIP64_EXTRA_ID = 0x0001;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_HEADER_SIZE = 46;
const UTF8_NAME_FLAG = 0x0800;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
// Well above the CLI's limits (10,000 files); a corrupt header cannot ask for more.
const MAX_ENTRIES = 50_000;
const MAX_DIRECTORY_BYTES = 16 * 1024 * 1024;

function corrupt(message: string): Error {
  return new Error(`Unreadable zip archive: ${message}`);
}

/** The uncompressed size from a ZIP64 extended information extra field. */
function zip64UncompressedSize(extra: Buffer): number {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const id = extra.readUInt16LE(offset);
    const length = extra.readUInt16LE(offset + 2);
    if (id === ZIP64_EXTRA_ID && length >= 8 && offset + 12 <= extra.length) {
      return Number(extra.readBigUInt64LE(offset + 4));
    }
    offset += 4 + length;
  }
  throw corrupt('missing ZIP64 size');
}

/** List the files of a zip archive of `size` bytes from its central directory. */
export async function readZipFileList(read: RangeReader, size: number): Promise<BundleFile[]> {
  if (size < EOCD_SIZE) throw corrupt('too small');
  const tailStart = Math.max(0, size - (EOCD_SIZE + MAX_COMMENT_LENGTH + ZIP64_LOCATOR_SIZE));
  const tail = await read(tailStart, size - 1);

  // The end-of-central-directory record ends the file, after an optional comment.
  let eocd = -1;
  for (let index = tail.length - EOCD_SIZE; index >= 0; index -= 1) {
    if (
      tail.readUInt32LE(index) === EOCD_SIGNATURE &&
      index + EOCD_SIZE + tail.readUInt16LE(index + 20) === tail.length
    ) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw corrupt('end of central directory not found');

  let entries = tail.readUInt16LE(eocd + 10);
  let directorySize = tail.readUInt32LE(eocd + 12);
  let directoryOffset = tail.readUInt32LE(eocd + 16);
  if (entries === MAX_UINT16 || directorySize === MAX_UINT32 || directoryOffset === MAX_UINT32) {
    const locator = eocd - ZIP64_LOCATOR_SIZE;
    if (locator < 0 || tail.readUInt32LE(locator) !== ZIP64_LOCATOR_SIGNATURE) {
      throw corrupt('ZIP64 locator not found');
    }
    const recordOffset = Number(tail.readBigUInt64LE(locator + 8));
    if (recordOffset + ZIP64_EOCD_SIZE > size) throw corrupt('ZIP64 record out of range');
    const record = await read(recordOffset, recordOffset + ZIP64_EOCD_SIZE - 1);
    if (record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) throw corrupt('ZIP64 record not found');
    entries = Number(record.readBigUInt64LE(32));
    directorySize = Number(record.readBigUInt64LE(40));
    directoryOffset = Number(record.readBigUInt64LE(48));
  }
  if (entries > MAX_ENTRIES || directorySize > MAX_DIRECTORY_BYTES) {
    throw corrupt('central directory too large');
  }
  if (directoryOffset + directorySize > size) throw corrupt('central directory out of range');

  const directory =
    directorySize === 0
      ? Buffer.alloc(0)
      : await read(directoryOffset, directoryOffset + directorySize - 1);
  const files: BundleFile[] = [];
  let offset = 0;
  for (let index = 0; index < entries; index += 1) {
    if (
      offset + CENTRAL_HEADER_SIZE > directory.length ||
      directory.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE
    ) {
      throw corrupt('bad central directory entry');
    }
    const flags = directory.readUInt16LE(offset + 8);
    const crc = directory.readUInt32LE(offset + 16);
    const uncompressedSize = directory.readUInt32LE(offset + 24);
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    const nameStart = offset + CENTRAL_HEADER_SIZE;
    const extraStart = nameStart + nameLength;
    offset = extraStart + extraLength + commentLength;
    if (offset > directory.length) throw corrupt('central directory entry out of range');

    const path = directory
      .subarray(nameStart, extraStart)
      .toString(flags & UTF8_NAME_FLAG ? 'utf8' : 'latin1');
    if (path.endsWith('/')) continue;
    files.push({
      path,
      size:
        uncompressedSize === MAX_UINT32
          ? zip64UncompressedSize(directory.subarray(extraStart, extraStart + extraLength))
          : uncompressedSize,
      hash: crc.toString(16).padStart(8, '0'),
    });
  }
  return files;
}

type DeltaListObject = { files?: Array<{ path?: unknown; sha256?: unknown; size?: unknown }> };

function parseDeltaList(text: string): BundleFile[] {
  const parsed = JSON.parse(text) as DeltaListObject;
  if (!Array.isArray(parsed.files)) throw new Error('Delta file list has no files');
  return parsed.files.map((file) => {
    if (
      typeof file.path !== 'string' ||
      typeof file.sha256 !== 'string' ||
      typeof file.size !== 'number'
    ) {
      throw new Error('Malformed delta file list entry');
    }
    return { path: file.path, size: file.size, hash: file.sha256.toLowerCase() };
  });
}

/** The bundle's files, or why they cannot be listed. Never throws. */
export async function getBundleFileList(bundle: {
  id: string;
  strategy: string;
  storageKey: string;
  size: number;
  encryption: unknown;
}): Promise<BundleFileListResult> {
  // Encrypted archives are ciphertext; the server cannot see inside them.
  if (bundle.encryption !== null && bundle.encryption !== undefined) {
    return { ok: false, reason: 'encrypted' };
  }
  try {
    if (bundle.strategy === 'deltas') {
      return {
        ok: true,
        list: { hashType: 'sha256', files: parseDeltaList(await getTextObject(bundle.storageKey)) },
      };
    }
    const files = await readZipFileList(
      (start, end) => getObjectRange(bundle.storageKey, start, end),
      bundle.size,
    );
    return { ok: true, list: { hashType: 'crc32', files } };
  } catch (error) {
    console.warn('[BundleFiles] cannot list bundle files', { bundleId: bundle.id, error });
    return { ok: false, reason: 'unreadable' };
  }
}
