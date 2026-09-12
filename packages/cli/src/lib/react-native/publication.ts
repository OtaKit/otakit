import { readFile } from 'node:fs/promises';
import { ApiClient } from '../api.js';
import {
  newPublicationReceipt,
  resumePublication,
  withReceiptLock,
  writeReceipt,
  type PublicationArguments,
} from './receipts.js';

/** Deliberate preparation is separate from resuming a possibly committed operation. */
export async function prepareRNPublication(input: {
  api: ApiClient;
  serverUrl: string;
  organizationId: string;
  receiptPath: string;
  arguments: Omit<PublicationArguments, 'expectedCurrentReleaseId'>;
}) {
  return withReceiptLock(input.receiptPath, async () => {
    try {
      await readFile(input.receiptPath);
      throw new Error('A publication receipt already exists; resume or reconcile it.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const prepared = await input.api.prepareRNRelease(
      input.arguments.bundleId,
      input.arguments.channel,
    );
    if (
      !prepared.rnIntent ||
      prepared.platform !== input.arguments.platform ||
      prepared.runtimeVersion !== input.arguments.runtimeVersion
    )
      throw new Error('Server preparation differs from the exported RN target');
    const receipt = newPublicationReceipt({
      serverUrl: input.serverUrl,
      organizationId: input.organizationId,
      intent: prepared.rnIntent,
      arguments: {
        ...input.arguments,
        expectedCurrentReleaseId: prepared.expectedCurrentReleaseId,
      },
    });
    await writeReceipt(input.receiptPath, receipt);
    return receipt;
  });
}

export async function publishRNReceipt(input: {
  api: ApiClient;
  serverUrl: string;
  organizationId: string;
  receiptPath: string;
  actorKey: string;
  arguments: PublicationArguments;
}) {
  return resumePublication({
    ...input,
    send: (receipt) =>
      input.api.release(receipt.arguments.channel, receipt.arguments.bundleId, {
        ...receipt.arguments,
        rnIntent: receipt.intent,
        idempotencyKey: receipt.operationKey,
      }),
  });
}
