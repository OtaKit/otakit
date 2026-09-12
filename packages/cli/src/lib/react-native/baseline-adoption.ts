import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  canonicalJSON,
  hashInventory,
  parseRNInventory,
  type DeltaFileEntry,
  type EmbeddedReceipt,
} from '@otakit/rn-protocol';
import { deriveKid, type BundleEncryptionParams } from '../crypto.js';
import { decryptRNArchive, MAX_RN_PAYLOAD, verifyRNArchive } from './artifacts.js';
import { withReceiptLock, writeReceipt } from './receipts.js';

export interface BaselineAdoption {
  id: string;
  appId: string;
  framework: 'react-native';
  platform: 'ios' | 'android';
  runtimeVersion: string;
  version: string;
  sha256: string;
  contentHash: string;
  size: number;
  strategy: 'zip' | 'deltas';
  encryption: BundleEncryptionParams | null;
  embeddedReceipt: EmbeddedReceipt;
  baselineBundleId: null;
  files: DeltaFileEntry[];
  downloadUrl: string;
  fileUrls?: Array<DeltaFileEntry & { url: string }>;
}

/** URLs are delivery locations, not durable artifact identity or receipt credentials. */
export function baselineIdentity(stored: BaselineAdoption) {
  return {
    id: stored.id,
    appId: stored.appId,
    framework: stored.framework,
    platform: stored.platform,
    runtimeVersion: stored.runtimeVersion,
    version: stored.version,
    sha256: stored.sha256,
    contentHash: stored.contentHash,
    size: stored.size,
    strategy: stored.strategy,
    encryption: stored.encryption,
    embeddedReceipt: stored.embeddedReceipt,
    baselineBundleId: stored.baselineBundleId,
    files: stored.files,
  };
}

async function fetchBounded(url: string, limit: number, fetcher: typeof fetch): Promise<Buffer> {
  const parsed = new URL(url);
  if (
    parsed.username ||
    parsed.password ||
    (parsed.protocol !== 'https:' &&
      !(
        parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      ))
  )
    throw new Error('Baseline download requires HTTPS');
  const response = await fetcher(url, { signal: AbortSignal.timeout(300_000), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('Stored baseline object is unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > limit) throw new Error('Stored baseline exceeds its declared size');
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

/** This separate action verifies the representation actually stored by the winning uploader. */
interface AdoptionOptions {
  stored: BaselineAdoption;
  expected: EmbeddedReceipt;
  files: DeltaFileEntry[];
  strategy: 'zip' | 'deltas';
  encryptionKey: Buffer | null;
  receiptPath: string;
  fetcher?: typeof fetch;
}
export async function adoptBaseline(options: AdoptionOptions): Promise<BaselineAdoption> {
  return withReceiptLock(options.receiptPath, async () => {
    try {
      const saved = JSON.parse(await readFile(options.receiptPath, 'utf8'));
      if (
        saved.format !== 'otakit-rn-baseline-adoption' ||
        saved.version !== 1 ||
        canonicalJSON(saved.bundle) !== canonicalJSON(baselineIdentity(options.stored))
      )
        throw new Error(
          'An incompatible receipt already exists; preserve it and select a new adoption receipt path.',
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return verifyAndAdoptBaseline(options);
  });
}

async function verifyAndAdoptBaseline(options: AdoptionOptions): Promise<BaselineAdoption> {
  const { stored, expected } = options;
  const inventory = parseRNInventory(stored.files, MAX_RN_PAYLOAD);
  if (
    !inventory.ok ||
    !stored.id ||
    stored.framework !== 'react-native' ||
    stored.baselineBundleId !== null ||
    canonicalJSON(stored.embeddedReceipt) !== canonicalJSON(expected) ||
    stored.appId !== expected.appId ||
    stored.platform !== expected.platform ||
    stored.runtimeVersion !== expected.runtimeVersion ||
    stored.version !== expected.version ||
    hashInventory(options.files) !== expected.embeddedContentHash ||
    stored.contentHash !== expected.embeddedContentHash ||
    hashInventory(stored.files) !== stored.contentHash ||
    canonicalJSON(stored.files.slice().sort((a, b) => (a.path < b.path ? -1 : 1))) !==
      canonicalJSON(options.files.slice().sort((a, b) => (a.path < b.path ? -1 : 1))) ||
    stored.strategy !== options.strategy ||
    (stored.encryption?.kid ?? null) !==
      (options.encryptionKey ? deriveKid(options.encryptionKey) : null) ||
    !Number.isSafeInteger(stored.size) ||
    stored.size <= 0 ||
    stored.size > MAX_RN_PAYLOAD
  )
    throw new Error('RN baseline adoption conflicts with the archived build or encryption policy');
  const fetcher = options.fetcher ?? fetch;
  if (stored.strategy === 'zip') {
    let bytes = await fetchBounded(stored.downloadUrl, stored.size, fetcher);
    if (
      bytes.length !== stored.size ||
      createHash('sha256').update(bytes).digest('hex') !== stored.sha256
    )
      throw new Error('Stored baseline transport hash/size mismatch');
    if (stored.encryption)
      bytes = decryptRNArchive(bytes, stored.encryption, options.encryptionKey!);
    await verifyRNArchive(bytes, options.files);
  } else {
    if (
      stored.encryption ||
      options.encryptionKey ||
      stored.sha256 !== stored.contentHash ||
      options.files.reduce((sum, file) => sum + file.size, 0) !== stored.size ||
      stored.fileUrls?.length !== options.files.length
    )
      throw new Error('Invalid delta baseline representation');
    const urls = new Map(stored.fileUrls.map((file) => [file.path, file]));
    if (urls.size !== options.files.length) throw new Error('Duplicate baseline file URL');
    for (const file of options.files) {
      const entry = urls.get(file.path);
      if (!entry || entry.sha256 !== file.sha256 || entry.size !== file.size)
        throw new Error('Baseline file mapping mismatch');
      const bytes = await fetchBounded(entry.url, file.size, fetcher);
      if (
        bytes.length !== file.size ||
        createHash('sha256').update(bytes).digest('hex') !== file.sha256
      )
        throw new Error(`Stored baseline file is corrupt: ${file.path}`);
    }
  }
  // Receipt describes the adopted transport, never the unused local ciphertext.
  await writeReceipt(options.receiptPath, {
    format: 'otakit-rn-baseline-adoption',
    version: 1,
    verifiedAt: new Date().toISOString(),
    bundle: baselineIdentity(stored),
  });
  return stored;
}
