import type { Prisma, PrismaClient, RemoteConfig, RemoteConfigVersion } from '@prisma/client';

import { recordAuditLog, type AuditActor } from '@/lib/audit-log';
import { getOrganizationEntitlements } from '@/lib/billing/service';
import { buildConfigUrl, writeConfigFile } from '@/lib/config-files';
import { db } from '@/lib/db';
import { scheduleNotificationDelivery } from '@/lib/notifications/deliver';
import { emitNotification } from '@/lib/notifications/emit';
import { isPolarConfigured } from '@/lib/polar';
import {
  configChannelKey,
  configKeyChanges,
  MAX_CONFIG_MESSAGE_LENGTH,
  validateConfigValues,
  type ConfigValues,
  type ConfigWarning,
} from '@/lib/remote-config';
import { isReleasableChannelName } from '@/lib/validation';

import { OtaKitServiceError } from './errors';
import { lockTransaction } from './releases';

/**
 * Remote config: one JSON object per app and channel, versioned in the
 * database and served as a signed CDN file. The database is the source of
 * truth; the file is rebuilt from the latest version under the same lock, and
 * a failed write is repaired by reconcileRemoteConfigFiles.
 */

const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;
const HISTORY_LIMIT = 50;

type Database = PrismaClient | Prisma.TransactionClient;

export type RemoteConfigStatus = 'live' | 'deleted' | 'none';

export type RemoteConfigState = {
  appId: string;
  /** Null for the base channel. */
  channel: string | null;
  /** Pass as expectedVersion to change it; 0 when the channel never had config. */
  version: number;
  /** `none`: never configured; `deleted`: devices on the channel use the base config. */
  status: RemoteConfigStatus;
  values: ConfigValues | null;
  message: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  /** True when devices on this (named) channel read the base channel's config instead. */
  usesBaseConfig: boolean;
  /** Whether the CDN file matches the latest version. */
  publicationStatus: 'published' | 'pending';
  /** The signed file devices read (a signed deletion after a delete). */
  fileUrl: string | null;
};

export type RemoteConfigHistoryEntry = {
  version: number;
  deleted: boolean;
  values: ConfigValues | null;
  message: string | null;
  createdBy: string;
  createdAt: string;
};

export type RemoteConfigWriteResult = {
  config: RemoteConfigState;
  /** False when the values equal the live ones: nothing was published. */
  changed: boolean;
  warnings: ConfigWarning[];
};

type Context = {
  organizationId: string;
  actor: AuditActor;
  appId: string;
  /** Extra audit fields, such as the MCP client that made the change. */
  auditMetadata?: Record<string, unknown>;
};

function lockKey(appId: string, channel: string | null): string {
  return `remote-config:${appId}:${configChannelKey(channel)}`;
}

function invalid(message: string): OtaKitServiceError {
  return new OtaKitServiceError('INVALID_INPUT', message, 400);
}

export function parseConfigChannel(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !isReleasableChannelName(value)) {
    throw new OtaKitServiceError(
      'INVALID_LANE',
      'Invalid channel. Use null or omit it for the base channel.',
      400,
    );
  }
  return value;
}

function parseExpectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalid('expectedVersion must be the current version (0 when the channel has no config)');
  }
  return value;
}

function parseMessage(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalid('message must be a string');
  const message = value.trim().replace(/\s+/g, ' ');
  if (message.length > MAX_CONFIG_MESSAGE_LENGTH) {
    throw invalid(`message can have at most ${MAX_CONFIG_MESSAGE_LENGTH} characters`);
  }
  return message || null;
}

async function ensureApp(database: Database, organizationId: string, appId: string): Promise<void> {
  const app = await database.app.findFirst({
    where: { id: appId, organizationId },
    select: { id: true },
  });
  if (!app) throw new OtaKitServiceError('APP_NOT_FOUND', 'App not found', 404);
}

/**
 * Free workspaces configure the base channel (named channels without their own
 * config use it). Self-hosted servers without billing have no plan limits.
 */
async function ensureChannelAllowed(organizationId: string, channel: string | null) {
  if (channel === null || !isPolarConfigured()) return;
  const entitlements = await getOrganizationEntitlements(organizationId);
  if (entitlements.planKey === 'free') {
    throw new OtaKitServiceError(
      'PLAN_REQUIRED',
      'Config for named channels needs a paid plan. On Free, configure the base channel: every channel without its own config uses it.',
      403,
      'Upgrade in Settings → Billing, or publish to the base channel.',
    );
  }
}

type ConfigWithLatest = RemoteConfig & { versions: RemoteConfigVersion[] };

async function findConfig(
  database: Database,
  appId: string,
  channel: string | null,
): Promise<ConfigWithLatest | null> {
  return database.remoteConfig.findUnique({
    where: { appId_channelKey: { appId, channelKey: configChannelKey(channel) } },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });
}

function parseValues(valuesJson: string): ConfigValues {
  return JSON.parse(valuesJson) as ConfigValues;
}

function toState(
  appId: string,
  channel: string | null,
  config: ConfigWithLatest | null,
): RemoteConfigState {
  const latest = config?.versions[0] ?? null;
  const status: RemoteConfigStatus = !latest ? 'none' : latest.deleted ? 'deleted' : 'live';
  return {
    appId,
    channel,
    version: config?.currentVersion ?? 0,
    status,
    values: status === 'live' && latest ? parseValues(latest.valuesJson) : null,
    message: latest?.message ?? null,
    updatedBy: latest?.createdBy ?? null,
    updatedAt: latest?.createdAt.toISOString() ?? null,
    usesBaseConfig: channel !== null && status !== 'live',
    publicationStatus:
      !config || config.syncedVersion >= config.currentVersion ? 'published' : 'pending',
    fileUrl: status === 'none' ? null : buildConfigUrl(appId, channel),
  };
}

function staleVersion(current: number): OtaKitServiceError {
  return new OtaKitServiceError(
    'STALE_CONFIG_VERSION',
    current === 0
      ? 'The channel has no config yet; pass expectedVersion 0'
      : `The config changed: version ${current} is the latest`,
    409,
    'Read the config again and apply your change to the latest version.',
  );
}

/**
 * Rewrite (or delete) the CDN file from the latest version, under the
 * channel's lock so two writes can never land in the opposite order.
 */
export async function syncRemoteConfigFile(
  appId: string,
  channel: string | null,
  database: PrismaClient = db,
): Promise<'published' | 'pending'> {
  try {
    await database.$transaction(async (tx) => {
      await lockTransaction(tx, lockKey(appId, channel));
      const config = await findConfig(tx, appId, channel);
      const latest = config?.versions[0];
      if (!config || !latest) return;
      // A deletion is written as a signed file too, so devices know it is real
      // and never accept an older version again.
      await writeConfigFile({
        appId,
        channel,
        version: latest.version,
        deleted: latest.deleted,
        valuesJson: latest.deleted ? '{}' : latest.valuesJson,
        experimentsJson: latest.deleted ? null : latest.experimentsJson,
        updatedAt: latest.createdAt.toISOString(),
      });
      await tx.remoteConfig.update({
        where: { id: config.id },
        data: { syncedVersion: latest.version },
      });
    }, TRANSACTION_OPTIONS);
    return 'published';
  } catch (error) {
    console.error('[RemoteConfig] file sync failed; the reconcile job retries', {
      appId,
      channel,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'pending';
  }
}

/** Write every file whose latest version has not reached the CDN yet. */
export async function reconcileRemoteConfigFiles(
  database: PrismaClient = db,
): Promise<{ checked: number; repaired: number; pending: number }> {
  const stale = await database.remoteConfig.findMany({
    where: { syncedVersion: { lt: database.remoteConfig.fields.currentVersion } },
    select: { appId: true, channel: true },
    take: 100,
  });
  let repaired = 0;
  for (const config of stale) {
    if ((await syncRemoteConfigFile(config.appId, config.channel, database)) === 'published') {
      repaired += 1;
    }
  }
  return { checked: stale.length, repaired, pending: stale.length - repaired };
}

export async function getRemoteConfig(input: {
  organizationId: string;
  appId: string;
  channel: string | null;
}): Promise<RemoteConfigState> {
  await ensureApp(db, input.organizationId, input.appId);
  return toState(input.appId, input.channel, await findConfig(db, input.appId, input.channel));
}

/** Every channel that has or had config, base channel first. */
export async function listRemoteConfigs(input: {
  organizationId: string;
  appId: string;
}): Promise<RemoteConfigState[]> {
  await ensureApp(db, input.organizationId, input.appId);
  const configs = await db.remoteConfig.findMany({
    where: { appId: input.appId },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });
  return configs
    .map((config) => toState(input.appId, config.channel, config))
    .sort((left, right) =>
      left.channel === null
        ? -1
        : right.channel === null
          ? 1
          : left.channel.localeCompare(right.channel),
    );
}

export async function getRemoteConfigHistory(input: {
  organizationId: string;
  appId: string;
  channel: string | null;
}): Promise<RemoteConfigHistoryEntry[]> {
  await ensureApp(db, input.organizationId, input.appId);
  const versions = await db.remoteConfigVersion.findMany({
    where: { config: { appId: input.appId, channelKey: configChannelKey(input.channel) } },
    orderBy: { version: 'desc' },
    take: HISTORY_LIMIT,
  });
  return versions.map((version) => ({
    version: version.version,
    deleted: version.deleted,
    values: version.deleted ? null : parseValues(version.valuesJson),
    message: version.message,
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
  }));
}

/**
 * Write a new version (or a deletion) of a channel's config. `next` gets the
 * latest version and returns the new values, null to delete, or undefined when
 * nothing changes.
 */
async function writeVersion(
  context: Context,
  input: {
    channel: string | null;
    expectedVersion: number;
    message: string | null;
    auditExtra?: Record<string, unknown>;
  },
  next: (
    latest: RemoteConfigVersion | null,
  ) => { valuesJson: string; values: ConfigValues } | null | undefined,
): Promise<{ config: RemoteConfigState; changed: boolean }> {
  const { appId } = context;
  const committed = await db.$transaction(async (tx) => {
    await ensureApp(tx, context.organizationId, appId);
    await lockTransaction(tx, lockKey(appId, input.channel));
    const config = await findConfig(tx, appId, input.channel);
    const current = config?.currentVersion ?? 0;
    if (input.expectedVersion !== current) throw staleVersion(current);

    const latest = config?.versions[0] ?? null;
    const live = latest && !latest.deleted ? latest : null;
    const update = next(latest);
    if (update === undefined) return null;

    const version = current + 1;
    const deleted = update === null;
    const saved = config
      ? await tx.remoteConfig.update({
          where: { id: config.id },
          data: { currentVersion: version },
        })
      : await tx.remoteConfig.create({
          data: {
            appId,
            channel: input.channel,
            channelKey: configChannelKey(input.channel),
            currentVersion: version,
          },
        });
    await tx.remoteConfigVersion.create({
      data: {
        configId: saved.id,
        version,
        valuesJson: update?.valuesJson ?? '{}',
        // Values and experiments change independently; a deletion ends both.
        experimentsJson: deleted ? null : (latest?.experimentsJson ?? null),
        deleted,
        message: input.message,
        createdBy: context.actor.actorLabel,
      },
    });

    const previousValues = live ? parseValues(live.valuesJson) : null;
    const changedKeys = configKeyChanges(previousValues, update?.values ?? {});
    const notified = await emitNotification(tx, {
      type: 'config.updated',
      key: `config.updated:${saved.id}:${version}`,
      organizationId: context.organizationId,
      appId,
      actor: context.actor,
      data: {
        config: {
          channel: input.channel,
          version,
          previousVersion: current,
          deleted,
          message: input.message,
          changedKeys,
          values: update?.values ?? null,
        },
      },
    });
    return { version, deleted, changedKeys, notified };
  }, TRANSACTION_OPTIONS);

  if (committed) {
    await recordAuditLog({
      organizationId: context.organizationId,
      actor: context.actor,
      action: committed.deleted ? 'config.deleted' : 'config.published',
      targetType: 'remote_config',
      targetId: `${appId}:${configChannelKey(input.channel)}`,
      metadata: {
        appId,
        channel: input.channel,
        version: committed.version,
        message: input.message,
        ...committed.changedKeys,
        ...input.auditExtra,
        ...context.auditMetadata,
      },
    });
    await syncRemoteConfigFile(appId, input.channel);
    if (committed.notified > 0) scheduleNotificationDelivery();
  }
  return {
    config: toState(appId, input.channel, await findConfig(db, appId, input.channel)),
    changed: committed !== null,
  };
}

/** Replace a channel's config with `values`. */
export async function publishRemoteConfig(
  context: Context,
  input: { channel: unknown; values: unknown; expectedVersion: unknown; message?: unknown },
): Promise<RemoteConfigWriteResult> {
  const channel = parseConfigChannel(input.channel);
  const expectedVersion = parseExpectedVersion(input.expectedVersion);
  const message = parseMessage(input.message);
  const validation = validateConfigValues(input.values);
  if (!validation.ok) throw invalid(validation.error);
  await ensureChannelAllowed(context.organizationId, channel);

  const result = await writeVersion(context, { channel, expectedVersion, message }, (latest) =>
    latest && !latest.deleted && latest.valuesJson === validation.valuesJson
      ? undefined
      : { valuesJson: validation.valuesJson, values: validation.values },
  );
  return { ...result, warnings: validation.warnings };
}

/** Set and remove top-level keys of the latest version. */
export async function patchRemoteConfig(
  context: Context,
  input: {
    channel: unknown;
    set?: unknown;
    unset?: unknown;
    expectedVersion: unknown;
    message?: unknown;
  },
): Promise<RemoteConfigWriteResult> {
  const channel = parseConfigChannel(input.channel);
  const expectedVersion = parseExpectedVersion(input.expectedVersion);
  const message = parseMessage(input.message);
  const set = input.set ?? {};
  if (set === null || typeof set !== 'object' || Array.isArray(set)) {
    throw invalid('set must be an object of keys and their new values');
  }
  const unset = input.unset ?? [];
  if (!Array.isArray(unset) || unset.some((key) => typeof key !== 'string')) {
    throw invalid('unset must be a list of keys');
  }
  if (Object.keys(set).length === 0 && unset.length === 0) {
    throw invalid('Pass keys to set or unset');
  }
  const overlap = (unset as string[]).find((key) => Object.hasOwn(set, key));
  if (overlap !== undefined) throw invalid(`"${overlap}" is both set and unset`);
  await ensureChannelAllowed(context.organizationId, channel);

  let warnings: ConfigWarning[] = [];
  const result = await writeVersion(context, { channel, expectedVersion, message }, (latest) => {
    const current = latest && !latest.deleted ? parseValues(latest.valuesJson) : {};
    const values: ConfigValues = {};
    for (const [key, value] of Object.entries(current)) {
      if (!(unset as string[]).includes(key)) values[key] = value;
    }
    for (const [key, value] of Object.entries(set as ConfigValues)) {
      // defineProperty, so a key can never reach the prototype.
      Object.defineProperty(values, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    const validation = validateConfigValues(values);
    if (!validation.ok) throw invalid(validation.error);
    warnings = validation.warnings;
    return latest && !latest.deleted && latest.valuesJson === validation.valuesJson
      ? undefined
      : { valuesJson: validation.valuesJson, values: validation.values };
  });
  return { ...result, warnings };
}

/** Publish the values of an earlier version as a new version. */
export async function restoreRemoteConfig(
  context: Context,
  input: { channel: unknown; version: unknown; expectedVersion: unknown; message?: unknown },
): Promise<RemoteConfigWriteResult> {
  const channel = parseConfigChannel(input.channel);
  const expectedVersion = parseExpectedVersion(input.expectedVersion);
  if (typeof input.version !== 'number' || !Number.isInteger(input.version) || input.version < 1) {
    throw invalid('version must be the version to restore');
  }
  const message = parseMessage(input.message) ?? `Restored version ${input.version}`;
  const restored = await db.remoteConfigVersion.findFirst({
    where: {
      version: input.version,
      config: {
        appId: context.appId,
        channelKey: configChannelKey(channel),
        app: { organizationId: context.organizationId },
      },
    },
  });
  if (!restored || restored.deleted) {
    throw new OtaKitServiceError(
      'CONFIG_NOT_FOUND',
      restored
        ? `Version ${input.version} is a deletion; restore a version with values`
        : `Version ${input.version} not found`,
      404,
    );
  }
  await ensureChannelAllowed(context.organizationId, channel);
  const values = parseValues(restored.valuesJson);
  const validation = validateConfigValues(values);
  const result = await writeVersion(
    context,
    { channel, expectedVersion, message, auditExtra: { restoredVersion: input.version } },
    (latest) =>
      latest && !latest.deleted && latest.valuesJson === restored.valuesJson
        ? undefined
        : { valuesJson: restored.valuesJson, values },
  );
  return { ...result, warnings: validation.ok ? validation.warnings : [] };
}

/** Delete a channel's config: its file goes away and its devices use the base config. */
export async function deleteRemoteConfig(
  context: Context,
  input: { channel: unknown; expectedVersion: unknown; message?: unknown },
): Promise<{ config: RemoteConfigState; changed: boolean }> {
  const channel = parseConfigChannel(input.channel);
  const expectedVersion = parseExpectedVersion(input.expectedVersion);
  const message = parseMessage(input.message);
  return writeVersion(context, { channel, expectedVersion, message }, (latest) => {
    if (!latest || latest.deleted) {
      throw new OtaKitServiceError('CONFIG_NOT_FOUND', 'This channel has no config to delete', 404);
    }
    return null;
  });
}
