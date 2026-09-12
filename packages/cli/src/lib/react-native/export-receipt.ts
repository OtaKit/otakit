import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  canonicalJSON,
  hashInventory,
  type DeltaFileEntry,
  type EmbeddedReceipt,
  type RNDescriptor,
  type RNPlatform,
} from '@otakit/rn-protocol';
import { hashBuffer } from '../hash.js';
import { MAX_RN_PAYLOAD, verifyRNArchive, verifyRNDirectory } from './artifacts.js';
import { assertSameNativeBuild, type NativeBuildRecord } from './build-record.js';

interface ExportIdentity {
  format: 'otakit-rn-export';
  version: 1;
  appId: string;
  platform: RNPlatform;
  runtimeVersion: string;
  displayVersion: string;
  contentHash: string;
  sha256: string;
  files: DeltaFileEntry[];
  sourceMap: 'private/index.map';
  archive: 'artifact.zip';
  payload: 'payload';
  mappingHash: string;
}
export interface EmbeddedExportReceipt extends ExportIdentity {
  purpose: 'embedded';
  nativeBuildId: string;
  embeddedReceipt: EmbeddedReceipt;
}
export interface OTAExportReceipt extends ExportIdentity {
  purpose: 'ota';
  baseline: {
    embeddedReceipt: EmbeddedReceipt;
    archive: 'private/baseline.zip';
    exportReceipt: 'private/baseline-export.json';
    completedBuild: 'private/completed-build.json';
    completedBuildHash: string;
  };
}
export type RNExportReceipt = EmbeddedExportReceipt | OTAExportReceipt;

export function embeddedBuildId(receipt: EmbeddedReceipt): string {
  return hashBuffer(Buffer.from(canonicalJSON(receipt)));
}

/** Fixed paths are intentional: receipt JSON never chooses which local files to read. */
export async function readEmbeddedExport(directory: string) {
  const receipt = JSON.parse(
    await readFile(join(directory, 'export.json'), 'utf8'),
  ) as EmbeddedExportReceipt;
  const nativeBuild = JSON.parse(
    await readFile(join(directory, 'private/native-build.json'), 'utf8'),
  ) as NativeBuildRecord;
  assertSameNativeBuild(nativeBuild, nativeBuild);
  if (
    receipt?.format !== 'otakit-rn-export' ||
    receipt.version !== 1 ||
    receipt.purpose !== 'embedded' ||
    receipt.archive !== 'artifact.zip' ||
    receipt.payload !== 'payload' ||
    receipt.sourceMap !== 'private/index.map' ||
    receipt.appId !== nativeBuild.identity.appId ||
    receipt.platform !== nativeBuild.identity.platform ||
    receipt.runtimeVersion !== nativeBuild.runtimeVersion
  )
    throw new Error('Expected an archived embedded export matching its native inputs');
  const expected: RNDescriptor = {
    format: 'otakit-rn',
    formatVersion: 1,
    framework: 'react-native',
    platform: receipt.platform,
    runtimeVersion: receipt.runtimeVersion,
    version: receipt.displayVersion,
    entryPoint: 'index.bundle',
    engine: 'hermes',
    bundleFormat: 'hermes-bytecode',
    reactNativeVersion: nativeBuild.identity.reactNativeVersion,
  };
  const verified = await verifyRNDirectory(
    join(directory, 'payload'),
    expected,
    nativeBuild.identity.hermesCompiler.bytecodeVersion,
  );
  const embedded: EmbeddedReceipt = {
    appId: receipt.appId,
    framework: 'react-native',
    platform: receipt.platform,
    runtimeVersion: receipt.runtimeVersion,
    version: receipt.displayVersion,
    embeddedContentHash: verified.contentHash,
  };
  const resource = JSON.parse(await readFile(join(directory, 'otakit-embedded.json'), 'utf8'));
  if (
    receipt.contentHash !== verified.contentHash ||
    receipt.nativeBuildId !== embeddedBuildId(embedded) ||
    hashInventory(receipt.files) !== verified.contentHash ||
    canonicalJSON(receipt.files) !== canonicalJSON(verified.files) ||
    canonicalJSON(receipt.embeddedReceipt) !== canonicalJSON(embedded) ||
    canonicalJSON(resource) !== canonicalJSON(embedded)
  )
    throw new Error('Embedded receipt or inventory differs from its archived payload');
  const archivePath = join(directory, 'artifact.zip');
  const info = await lstat(archivePath);
  if (!info.isFile() || info.size > MAX_RN_PAYLOAD)
    throw new Error('Invalid baseline archive file or size');
  const archive = await readFile(archivePath);
  if (hashBuffer(archive) !== receipt.sha256)
    throw new Error('Archived baseline transport hash mismatch');
  await verifyRNArchive(archive, receipt.files);
  return { receipt, nativeBuild, archive };
}
