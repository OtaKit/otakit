import { readFile, realpath } from 'node:fs/promises';
import { canonicalJSON, assertRuntime, type RNPlatform } from '@otakit/rn-protocol';
import { withReceiptLock, writeReceipt } from './receipts.js';
import {
  inspectRNUpload,
  normalizeUploadScope,
  uploadIdentity,
  uploadRNReceipt,
  type RNUploadReceipt,
  type UploadScope,
} from './upload.js';

export interface UploadCollection {
  format: 'otakit-rn-upload-collection';
  version: 1;
  scope: UploadScope;
  appId: string;
  displayVersion: string;
  targets: Array<{
    directory: string;
    platform: RNPlatform;
    runtimeVersion: string;
    identity: string;
  }>;
}
type Options = Omit<Parameters<typeof uploadRNReceipt>[0], 'directory' | 'expectedIdentity'> & {
  receiptPath: string;
};
type InspectOptions = Omit<Options, 'api'>;

async function inspectTargets(collection: UploadCollection, options: InspectOptions) {
  if (
    collection?.format !== 'otakit-rn-upload-collection' ||
    collection.version !== 1 ||
    !collection.appId ||
    !collection.displayVersion ||
    canonicalJSON(collection.scope) !== canonicalJSON(normalizeUploadScope(options.scope)) ||
    !Array.isArray(collection.targets) ||
    !collection.targets.length ||
    collection.targets.length > 100
  )
    throw new Error('RN_UPLOAD_SCOPE_LOST: invalid upload collection or changed account');
  const lanes = new Set<string>();
  const directories = new Set<string>();
  const receipts: RNUploadReceipt[] = [];
  for (const target of collection.targets) {
    assertRuntime(target.runtimeVersion);
    if (!['ios', 'android'].includes(target.platform) || !/^[a-f0-9]{64}$/.test(target.identity))
      throw new Error('Invalid RN upload collection target');
    const directory = await realpath(target.directory);
    const lane = `${target.platform}/${target.runtimeVersion}`;
    if (directory !== target.directory || lanes.has(lane) || directories.has(directory))
      throw new Error('Duplicate or moved RN upload collection target');
    lanes.add(lane);
    directories.add(directory);
    const receipt = await inspectRNUpload({
      ...options,
      directory,
      expectedIdentity: target.identity,
    });
    if (
      receipt.exported.appId !== collection.appId ||
      receipt.exported.displayVersion !== collection.displayVersion ||
      receipt.exported.platform !== target.platform ||
      receipt.exported.runtimeVersion !== target.runtimeVersion
    )
      throw new Error('RN upload collection targeting changed');
    receipts.push(receipt);
  }
  return receipts;
}

/** Reuse already prepared/encrypted variants; never create a second transport on retry. */
export async function prepareRNUploadCollection(
  options: InspectOptions & { directories: string[] },
): Promise<UploadCollection> {
  return withReceiptLock(options.receiptPath, async () => {
    try {
      await readFile(options.receiptPath);
      throw new Error('An upload collection already exists; resume its original receipt');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!options.directories.length || options.directories.length > 100)
      throw new Error('Select 1–100 prepared RN upload directories');
    const collection: UploadCollection = {
      format: 'otakit-rn-upload-collection',
      version: 1,
      scope: normalizeUploadScope(options.scope),
      appId: '',
      displayVersion: '',
      targets: [],
    };
    for (const path of options.directories) {
      const directory = await realpath(path);
      const receipt = await inspectRNUpload({ ...options, directory });
      if (!collection.appId) {
        collection.appId = receipt.exported.appId;
        collection.displayVersion = receipt.exported.displayVersion;
      }
      collection.targets.push({
        directory,
        platform: receipt.exported.platform,
        runtimeVersion: receipt.exported.runtimeVersion,
        identity: uploadIdentity(receipt),
      });
    }
    await inspectTargets(collection, options);
    await writeReceipt(options.receiptPath, collection);
    return collection;
  });
}

/** Child receipts are the durable progress record, including an uncertain finalization. */
export async function uploadRNCollection(options: Options) {
  return withReceiptLock(options.receiptPath, async () => {
    const collection = JSON.parse(await readFile(options.receiptPath, 'utf8')) as UploadCollection;
    // Verify every local archive and scope before the first external write.
    const receipts = await inspectTargets(collection, options);
    for (const [index, target] of collection.targets.entries()) {
      try {
        receipts[index] = await uploadRNReceipt({
          ...options,
          directory: target.directory,
          expectedIdentity: target.identity,
        });
      } catch (error) {
        const completed = receipts.filter((receipt) => receipt.ota.state === 'finalized').length;
        throw new Error(
          `RN_UPLOAD_COLLECTION_INCOMPLETE: ${completed}/${collection.targets.length} targets finalized; resume the original collection. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return {
      appId: collection.appId,
      version: collection.displayVersion,
      targets: receipts.map((receipt) => ({
        platform: receipt.exported.platform,
        runtimeVersion: receipt.exported.runtimeVersion,
        baselineBundleId: receipt.baseline.bundle!.id,
        otaBundleId: receipt.ota.bundle!.id,
      })),
    };
  });
}
