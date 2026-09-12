import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJSON, hashInventory, type RNDescriptor } from '@otakit/rn-protocol';
import { hashBuffer } from '../hash.js';
import { MAX_RN_PAYLOAD, verifyRNArchive, verifyRNDirectory } from './artifacts.js';
import { assertSameNativeBuild, type NativeBuildRecord } from './build-record.js';
import {
  assertCompletedBuild,
  completedBuildHash,
  type CompletedNativeBuild,
} from './completed-build.js';
import { embeddedBuildId, type OTAExportReceipt } from './export-receipt.js';

export async function readUploadArchive(path: string, sha256: string, size?: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.size <= 0 ||
      info.size > MAX_RN_PAYLOAD ||
      (size !== undefined && info.size !== size)
    )
      throw new Error('Invalid archived upload file size');
    // A fixed allocation also bounds memory if the file grows during the read.
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('Archived upload file changed during verification');
      offset += bytesRead;
    }
    if ((await file.stat()).size !== info.size || hashBuffer(bytes) !== sha256)
      throw new Error('Archived upload transport hash mismatch');
    return bytes;
  } finally {
    await file.close();
  }
}

export function assertUploadProvenance(receipt: OTAExportReceipt, completed: CompletedNativeBuild) {
  assertCompletedBuild(completed);
  const { baseline, nativeBuild } = completed;
  if (
    receipt?.format !== 'otakit-rn-export' ||
    receipt.version !== 1 ||
    receipt.purpose !== 'ota' ||
    receipt.baseline?.completedBuildHash !== completedBuildHash(completed) ||
    canonicalJSON(receipt.baseline.embeddedReceipt) !== canonicalJSON(baseline.embeddedReceipt) ||
    receipt.appId !== nativeBuild.identity.appId ||
    receipt.platform !== nativeBuild.identity.platform ||
    receipt.runtimeVersion !== nativeBuild.runtimeVersion ||
    baseline.appId !== receipt.appId ||
    baseline.platform !== receipt.platform ||
    baseline.runtimeVersion !== receipt.runtimeVersion ||
    baseline.nativeBuildId !== embeddedBuildId(baseline.embeddedReceipt) ||
    canonicalJSON(baseline.embeddedReceipt) !==
      canonicalJSON({
        appId: baseline.appId,
        framework: 'react-native',
        platform: baseline.platform,
        runtimeVersion: baseline.runtimeVersion,
        version: baseline.displayVersion,
        embeddedContentHash: baseline.contentHash,
      }) ||
    hashInventory(baseline.files) !== baseline.contentHash
  )
    throw new Error('OTA export or its completed baseline provenance is inconsistent');
  if (receipt.displayVersion === baseline.displayVersion)
    throw new Error('The OTA version must differ from its embedded baseline version');
}

/** Upload works from archived exports; it must not recapture a newer native environment. */
export async function readOTAUploadExport(directory: string) {
  const receipt = JSON.parse(
    await readFile(join(directory, 'export.json'), 'utf8'),
  ) as OTAExportReceipt;
  const completed = JSON.parse(
    await readFile(join(directory, 'private/completed-build.json'), 'utf8'),
  ) as CompletedNativeBuild;
  assertCompletedBuild(completed);
  const nativeBuild = JSON.parse(
    await readFile(join(directory, 'private/native-build.json'), 'utf8'),
  ) as NativeBuildRecord;
  assertSameNativeBuild(completed.nativeBuild, nativeBuild);
  const baseline = completed.baseline;
  assertUploadProvenance(receipt, completed);
  const savedBaseline = JSON.parse(
    await readFile(join(directory, 'private/baseline-export.json'), 'utf8'),
  );
  if (
    receipt.archive !== 'artifact.zip' ||
    receipt.payload !== 'payload' ||
    receipt.sourceMap !== 'private/index.map' ||
    receipt.baseline?.archive !== 'private/baseline.zip' ||
    receipt.baseline.exportReceipt !== 'private/baseline-export.json' ||
    receipt.baseline.completedBuild !== 'private/completed-build.json' ||
    canonicalJSON(savedBaseline) !== canonicalJSON(baseline)
  )
    throw new Error('OTA export or its completed baseline provenance is inconsistent');
  const descriptor: RNDescriptor = {
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
    descriptor,
    nativeBuild.identity.hermesCompiler.bytecodeVersion,
  );
  if (
    receipt.contentHash !== verified.contentHash ||
    canonicalJSON(receipt.files) !== canonicalJSON(verified.files)
  )
    throw new Error('OTA payload differs from its export receipt');
  const otaBytes = await readUploadArchive(join(directory, 'artifact.zip'), receipt.sha256);
  await verifyRNArchive(otaBytes, receipt.files);
  const baselineBytes = await readUploadArchive(
    join(directory, 'private/baseline.zip'),
    baseline.sha256,
  );
  await verifyRNArchive(baselineBytes, baseline.files);
  return { receipt, completed, otaBytes, baselineBytes };
}
