import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { canonicalJSON, type RNPlatform } from '@otakit/rn-protocol';

export interface RNIntent {
  version: 1;
  actorKey: string;
  preparedAt: string;
}
export interface PublicationArguments {
  appId: string;
  platform: RNPlatform;
  runtimeVersion: string;
  bundleId: string;
  channel: string | null;
  expectedCurrentReleaseId: string | null;
  forceImmediate: boolean;
  autoRevert: boolean;
  autoRevertRatePercent?: number;
  autoRevertMinSample?: number;
}
export interface PublicationReceipt {
  format: 'otakit-rn-publication';
  version: 1;
  serverUrl: string;
  organizationId: string;
  operationKey: string;
  intent: RNIntent;
  arguments: PublicationArguments;
  preparedLocallyAt: string;
  lastAttemptAt: string | null;
  state: 'not-sent' | 'outcome-unknown' | 'committed';
  result?: unknown;
}

async function ensureReceiptDirectory(directory: string): Promise<void> {
  const firstCreated = await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!firstCreated) return;
  // Sync each newly created directory entry, including its existing parent. Syncing only
  // the receipt's immediate directory cannot preserve a newly created ancestor after a crash.
  const existingParent = dirname(resolve(firstCreated));
  for (let current = resolve(directory); ; current = dirname(current)) {
    const handle = await open(current, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (current === existingParent) break;
  }
}

export async function writeReceipt(path: string, value: unknown): Promise<void> {
  await ensureReceiptDirectory(dirname(path));
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(value, null, 2) + '\n');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    // Persist the directory entry as well as the data before sending a mutation.
    const directory = await open(dirname(path), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function withReceiptLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  await ensureReceiptDirectory(dirname(path));
  const lockPath = `${path}.lock`;
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch {
    throw new Error(
      `Receipt is locked: ${lockPath}. Reconcile an interrupted process before removing its lock.`,
    );
  }
  try {
    return await operation();
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

export function newPublicationReceipt(
  input: Omit<
    PublicationReceipt,
    'format' | 'version' | 'operationKey' | 'state' | 'lastAttemptAt' | 'preparedLocallyAt'
  >,
  now = new Date(),
): PublicationReceipt {
  return {
    ...input,
    format: 'otakit-rn-publication',
    version: 1,
    operationKey: randomUUID(),
    state: 'not-sent',
    lastAttemptAt: null,
    preparedLocallyAt: now.toISOString(),
  };
}

interface ReplayScope {
  serverUrl: string;
  organizationId: string;
  actorKey: string;
  arguments: PublicationArguments;
  now?: Date;
}

/** Collections use the same replay checks for every target before sending the first mutation. */
export function assertPublicationReplay(receipt: PublicationReceipt, options: ReplayScope): void {
  if (
    receipt.format !== 'otakit-rn-publication' ||
    receipt.version !== 1 ||
    typeof receipt.operationKey !== 'string' ||
    !receipt.operationKey ||
    receipt.serverUrl !== options.serverUrl ||
    receipt.organizationId !== options.organizationId ||
    canonicalJSON(receipt.arguments) !== canonicalJSON(options.arguments) ||
    receipt.intent?.version !== 1 ||
    receipt.intent.actorKey !== options.actorKey ||
    !['not-sent', 'outcome-unknown', 'committed'].includes(receipt.state)
  )
    throw new Error(
      'RN_REPLAY_SCOPE_LOST: reconcile the original operation; its receipt or actor no longer matches.',
    );
  if (receipt.state === 'committed') {
    if (!Object.hasOwn(receipt, 'result'))
      throw new Error(
        'RN_REPLAY_SCOPE_LOST: committed receipt has no result; reconcile the original operation.',
      );
    return;
  }
  const now = (options.now ?? new Date()).getTime();
  const prepared = Date.parse(receipt.preparedLocallyAt);
  const serverPrepared = Date.parse(receipt.intent.preparedAt);
  const last = receipt.lastAttemptAt === null ? prepared : Date.parse(receipt.lastAttemptAt);
  if (
    ![now, prepared, serverPrepared, last].every(Number.isFinite) ||
    now < last ||
    last < prepared ||
    Math.abs(serverPrepared - prepared) > 5 * 60_000 ||
    now - prepared > 23 * 3600_000
  )
    throw new Error(
      'RN_REPLAY_SCOPE_LOST: retry window or clock evidence is unsafe; reconcile the original operation.',
    );
}

export async function resumePublication<T>(
  options: ReplayScope & {
    receiptPath: string;
    send: (receipt: PublicationReceipt) => Promise<T>;
  },
): Promise<T> {
  return withReceiptLock(options.receiptPath, async () => {
    const receipt = JSON.parse(await readFile(options.receiptPath, 'utf8')) as PublicationReceipt;
    assertPublicationReplay(receipt, options);
    if (receipt.state === 'committed') return receipt.result as T;
    receipt.state = 'outcome-unknown';
    receipt.lastAttemptAt = (options.now ?? new Date()).toISOString();
    await writeReceipt(options.receiptPath, receipt);
    const result = await options.send(receipt);
    if (result === undefined)
      throw new Error(
        'RN publication returned no result; the original operation remains outcome-unknown.',
      );
    receipt.result = result;
    receipt.state = 'committed';
    await writeReceipt(options.receiptPath, receipt);
    return result;
  });
}
