import { readFile } from 'node:fs/promises';
import { assertRuntime } from '@otakit/rn-protocol';
import type { ApiClient } from '../api.js';
import {
  assertPublicationReplay,
  newPublicationReceipt,
  withReceiptLock,
  writeReceipt,
  type PublicationReceipt,
} from './receipts.js';

interface CollectionScope {
  appId: string;
  serverUrl: string;
  organizationId: string;
  actorKey: string;
}
export interface PublicationCollection extends CollectionScope {
  format: 'otakit-rn-publication-collection';
  version: 1;
  displayVersion: string;
  targets: Array<{ sha256: string; baselineBundleId: string; publication: PublicationReceipt }>;
}
type CollectionAPI = Pick<ApiClient, 'prepareRNRelease' | 'release'>;
type Options = CollectionScope & { api: CollectionAPI; receiptPath: string };
const lane = (receipt: PublicationReceipt) =>
  JSON.stringify([
    receipt.arguments.platform,
    receipt.arguments.runtimeVersion,
    receipt.arguments.channel,
  ]);

function validate(collection: PublicationCollection, options: CollectionScope) {
  if (
    collection?.format !== 'otakit-rn-publication-collection' ||
    collection.version !== 1 ||
    !collection.displayVersion ||
    !Array.isArray(collection.targets) ||
    !collection.targets.length ||
    collection.targets.length > 100 ||
    ['appId', 'serverUrl', 'organizationId', 'actorKey'].some(
      (key) => collection[key as keyof CollectionScope] !== options[key as keyof CollectionScope],
    )
  )
    throw new Error('RN_REPLAY_SCOPE_LOST: collection scope or target inventory changed');
  const lanes = new Set<string>();
  const operations = new Set<string>();
  for (const target of collection.targets) {
    const receipt = target.publication;
    if (
      !receipt?.arguments ||
      receipt.arguments.appId !== collection.appId ||
      !['ios', 'android'].includes(receipt.arguments.platform) ||
      !receipt.arguments.bundleId ||
      !target.baselineBundleId ||
      !/^[a-f0-9]{64}$/.test(target.sha256)
    )
      throw new Error('Invalid RN collection target');
    assertRuntime(receipt.arguments.runtimeVersion);
    if (lanes.has(lane(receipt)) || operations.has(receipt.operationKey))
      throw new Error('Duplicate RN collection lane or operation');
    lanes.add(lane(receipt));
    operations.add(receipt.operationKey);
    assertPublicationReplay(receipt, { ...options, arguments: receipt.arguments });
  }
}

/** Preflight every selected uploaded variant; this action never publishes. */
export async function prepareRNCollection(
  options: Options & {
    bundleIds: string[];
    channel: string | null;
    forceImmediate: boolean;
  },
): Promise<PublicationCollection> {
  return withReceiptLock(options.receiptPath, async () => {
    try {
      await readFile(options.receiptPath);
      throw new Error('A collection receipt already exists; resume or reconcile it.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (
      !options.bundleIds.length ||
      options.bundleIds.length > 100 ||
      new Set(options.bundleIds).size !== options.bundleIds.length ||
      options.bundleIds.some((id) => typeof id !== 'string' || !id)
    )
      throw new Error('Select 1–100 distinct uploaded RN bundle IDs');
    const collection: PublicationCollection = {
      format: 'otakit-rn-publication-collection',
      version: 1,
      appId: options.appId,
      serverUrl: options.serverUrl,
      organizationId: options.organizationId,
      actorKey: options.actorKey,
      displayVersion: '',
      targets: [],
    };
    for (const bundleId of options.bundleIds) {
      const prepared = await options.api.prepareRNRelease(bundleId, options.channel);
      if (
        prepared.proposedBundle?.id !== bundleId ||
        typeof prepared.proposedBundle.version !== 'string' ||
        !prepared.proposedBundle.version ||
        (collection.displayVersion && collection.displayVersion !== prepared.proposedBundle.version)
      )
        throw new Error('All RN collection targets must be uploaded variants of the same version');
      collection.displayVersion = prepared.proposedBundle.version;
      collection.targets.push({
        sha256: prepared.proposedBundle.sha256,
        baselineBundleId: prepared.baselineBundleId,
        publication: newPublicationReceipt({
          serverUrl: options.serverUrl,
          organizationId: options.organizationId,
          intent: prepared.rnIntent,
          arguments: {
            appId: options.appId,
            bundleId,
            platform: prepared.platform,
            runtimeVersion: prepared.runtimeVersion,
            channel: options.channel,
            expectedCurrentReleaseId: prepared.expectedCurrentReleaseId,
            forceImmediate: options.forceImmediate,
            autoRevert: false,
          },
        }),
      });
    }
    collection.targets.sort((a, b) =>
      lane(a.publication) < lane(b.publication)
        ? -1
        : lane(a.publication) > lane(b.publication)
          ? 1
          : 0,
    );
    validate(collection, options);
    await writeReceipt(options.receiptPath, collection);
    return collection;
  });
}

export function collectionSummary(collection: PublicationCollection) {
  return {
    version: collection.displayVersion,
    targets: collection.targets.map(({ publication }) => ({
      bundleId: publication.arguments.bundleId,
      platform: publication.arguments.platform,
      runtimeVersion: publication.arguments.runtimeVersion,
      channel: publication.arguments.channel,
      state: publication.state,
      ...(publication.result === undefined ? {} : { result: publication.result }),
    })),
  };
}

/** Independent lane commits cannot be atomic; uncertainty stops later targets and remains durable. */
export async function publishRNCollection(options: Options): Promise<PublicationCollection> {
  return withReceiptLock(options.receiptPath, async () => {
    const collection = JSON.parse(
      await readFile(options.receiptPath, 'utf8'),
    ) as PublicationCollection;
    validate(collection, options);
    for (const target of collection.targets) {
      const receipt = target.publication;
      if (receipt.state === 'committed') continue;
      assertPublicationReplay(receipt, { ...options, arguments: receipt.arguments });
      receipt.state = 'outcome-unknown';
      receipt.lastAttemptAt = new Date().toISOString();
      await writeReceipt(options.receiptPath, collection);
      try {
        const result = await options.api.release(
          receipt.arguments.channel,
          receipt.arguments.bundleId,
          {
            ...receipt.arguments,
            rnIntent: receipt.intent,
            idempotencyKey: receipt.operationKey,
          },
        );
        if (result === undefined) throw new Error('Server returned no publication result');
        receipt.result = result;
        receipt.state = 'committed';
        await writeReceipt(options.receiptPath, collection);
      } catch (error) {
        // A failed response or local receipt write is not evidence that the server rejected it.
        const committed = collection.targets.filter(
          (item) => item.publication.state === 'committed' && item !== target,
        ).length;
        throw new Error(
          `RN_COLLECTION_INCOMPLETE: ${committed}/${collection.targets.length} other targets committed; ${receipt.arguments.platform}/${receipt.arguments.runtimeVersion} requires retry or reconciliation with the original receipt. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return collection;
  });
}
