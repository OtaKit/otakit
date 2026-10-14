import { Prisma, type Experiment, type PrismaClient } from '@prisma/client';

import { recordAuditLog, type AuditActor } from '@/lib/audit-log';
import { getOrganizationEntitlements } from '@/lib/billing/service';
import { db } from '@/lib/db';
import {
  analyzeExperiment,
  plannedSamplePerVariant,
  type ExperimentStats,
  type ExperimentVerdict,
} from '@/lib/experiment-stats';
import {
  buildExperimentsJson,
  EXPERIMENT_KEY_PATTERN,
  experimentsJsonBytes,
  GOAL_EVENT_PATTERN,
  MAX_EXPERIMENTS_JSON_BYTES,
  MAX_RUNNING_PER_FILE,
  overriddenKeys,
  sharedOverrideKeys,
  validateExperimentDefinition,
  type DeviceExperiment,
  type ExperimentDefinition,
  type ExperimentStatusValue,
  type ExperimentVariant,
} from '@/lib/experiments';
import { scheduleNotificationDelivery } from '@/lib/notifications/deliver';
import { emitNotification } from '@/lib/notifications/emit';
import type {
  NotificationExperiment,
  NotificationExperimentVariant,
  NotificationExperimentVerdict,
} from '@/lib/notifications/events';
import { isPolarConfigured } from '@/lib/polar';
import { configChannelKey, validateConfigValues, type ConfigValues } from '@/lib/remote-config';
import { listAppEventNames } from '@/lib/tinybird/app-events';
import {
  CONVERSION,
  EXPERIMENT_ERROR,
  EXPOSURE,
  getExperimentReports,
  type ExperimentReportRow,
} from '@/lib/tinybird/experiments';

import { OtaKitServiceError } from './errors';
import { lockTransaction } from './releases';
import {
  lockConfigFile,
  parseConfigChannel,
  syncRemoteConfigFile,
  writeConfigFileVersion,
} from './remote-config';
import { getTelemetryUsageStatus } from './telemetry-usage';

/**
 * A/B tests. An experiment is a draft until it starts; then it rides in its
 * config file's signed experimentsJson and is locked (except its name) until
 * it stops or ships a variant. Devices pick their variant themselves and
 * report exposures, goals and errors at most once each; results count those
 * reports per variant.
 */

const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;
const DAY_MS = 86_400_000;
/** Drafts and running experiments per app, a bound against runaway scripts. */
const MAX_ACTIVE_PER_APP = 50;
/** The telemetry cron reads each running experiment's results at most this often. */
const VERDICT_CHECK_MS = 60 * 60 * 1000;

type Database = PrismaClient | Prisma.TransactionClient;

type Context = {
  organizationId: string;
  actor: AuditActor;
  appId: string;
  /** Extra audit fields, such as the MCP client that made the change. */
  auditMetadata?: Record<string, unknown>;
};

type ReadContext = { organizationId: string; appId: string };

export type ExperimentSummary = {
  id: string;
  key: string;
  name: string;
  status: ExperimentStatusValue;
  /** The config file it runs in; null = the base config. */
  channel: string | null;
  audienceChannels: Array<string | null> | null;
  runtimeVersions: string[];
  trafficPercent: number;
  variants: ExperimentVariant[];
  goalEvent: string;
  secondaryEvents: string[];
  /** Config keys its variants override. */
  overriddenKeys: string[];
  startedAt: string | null;
  stoppedAt: string | null;
  shippedVariant: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function invalid(message: string): OtaKitServiceError {
  return new OtaKitServiceError('INVALID_INPUT', message, 400);
}

function variantsOf(row: Pick<Experiment, 'variants'>): ExperimentVariant[] {
  return Array.isArray(row.variants) ? (row.variants as unknown as ExperimentVariant[]) : [];
}

function audienceOf(row: Pick<Experiment, 'audienceChannels'>): Array<string | null> | null {
  return Array.isArray(row.audienceChannels)
    ? (row.audienceChannels as Array<string | null>)
    : null;
}

export function toExperimentSummary(row: Experiment): ExperimentSummary {
  const variants = variantsOf(row);
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    status: row.status,
    channel: row.channel,
    audienceChannels: audienceOf(row),
    runtimeVersions: row.runtimeVersions,
    trafficPercent: row.trafficPercent,
    variants,
    goalEvent: row.goalEvent,
    secondaryEvents: row.secondaryEvents,
    overriddenKeys: overriddenKeys(variants),
    startedAt: row.startedAt?.toISOString() ?? null,
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
    shippedVariant: row.shippedVariant,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function definitionOf(row: Experiment): ExperimentDefinition {
  return {
    key: row.key,
    name: row.name,
    channel: row.channel,
    audienceChannels: audienceOf(row),
    runtimeVersions: row.runtimeVersions,
    trafficPercent: row.trafficPercent,
    variants: variantsOf(row),
    goalEvent: row.goalEvent,
    secondaryEvents: row.secondaryEvents,
  };
}

function deviceExperiment(row: Experiment): DeviceExperiment {
  return {
    id: row.id,
    key: row.key,
    trafficPercent: row.trafficPercent,
    variants: variantsOf(row),
    goalEvent: row.goalEvent,
    secondaryEvents: row.secondaryEvents,
    audienceChannels: audienceOf(row),
    runtimeVersions: row.runtimeVersions,
  };
}

function notificationExperiment(row: Experiment): NotificationExperiment {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    status: row.status,
    channel: row.channel,
    goalEvent: row.goalEvent,
    variants: variantsOf(row).map((variant) => ({ key: variant.key, weight: variant.weight })),
    startedAt: row.startedAt?.toISOString() ?? null,
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
    shippedVariant: row.shippedVariant,
  };
}

function configLabel(channel: string | null): string {
  return channel === null ? 'the base config' : `the ${channel} config`;
}

async function ensureApp(database: Database, organizationId: string, appId: string) {
  const app = await database.app.findFirst({
    where: { id: appId, organizationId },
    select: { id: true },
  });
  if (!app) throw new OtaKitServiceError('APP_NOT_FOUND', 'App not found', 404);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** By ID, or by key: the draft or running one, else the latest that ended. */
async function findExperiment(
  database: Database,
  ctx: ReadContext,
  idOrKey: unknown,
): Promise<Experiment> {
  if (typeof idOrKey !== 'string' || !idOrKey.trim()) {
    throw invalid('Pass an A/B test ID or key');
  }
  const value = idOrKey.trim();
  const where = { appId: ctx.appId, app: { organizationId: ctx.organizationId } };
  const found = UUID.test(value)
    ? await database.experiment.findFirst({ where: { ...where, id: value.toLowerCase() } })
    : ((await database.experiment.findFirst({
        where: { ...where, key: value, status: { in: ['draft', 'running'] } },
      })) ??
      (await database.experiment.findFirst({
        where: { ...where, key: value },
        orderBy: { createdAt: 'desc' },
      })));
  if (!found) {
    throw new OtaKitServiceError(
      'EXPERIMENT_NOT_FOUND',
      `A/B test "${value.slice(0, 80)}" not found`,
      404,
      'List A/B tests with list_experiments (or GET /api/v1/apps/:appId/experiments).',
    );
  }
  return found;
}

const STATUS_ORDER: Record<ExperimentStatusValue, number> = {
  running: 0,
  draft: 1,
  stopped: 2,
  shipped: 2,
};

/** Running first, then drafts, then the ones that ended, newest first. */
export async function listExperiments(ctx: ReadContext): Promise<ExperimentSummary[]> {
  await ensureApp(db, ctx.organizationId, ctx.appId);
  const rows = await db.experiment.findMany({
    where: { appId: ctx.appId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const time = (row: Experiment) => (row.stoppedAt ?? row.startedAt ?? row.createdAt).getTime();
  return rows
    .sort(
      (left, right) =>
        STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || time(right) - time(left),
    )
    .map(toExperimentSummary);
}

export async function getExperiment(
  ctx: ReadContext,
  idOrKey: unknown,
): Promise<ExperimentSummary> {
  await ensureApp(db, ctx.organizationId, ctx.appId);
  return toExperimentSummary(await findExperiment(db, ctx, idOrKey));
}

function appLock(appId: string): string {
  return `experiments:${appId}`;
}

async function ensureKeyFree(
  tx: Prisma.TransactionClient,
  appId: string,
  key: string,
  exceptId?: string,
): Promise<void> {
  const taken = await tx.experiment.findFirst({
    where: {
      appId,
      key,
      status: { in: ['draft', 'running'] },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { status: true },
  });
  if (taken) {
    throw new OtaKitServiceError(
      'EXPERIMENT_KEY_TAKEN',
      `The ${taken.status === 'running' ? 'running' : 'draft'} A/B test "${key}" has this key; keys are unique until a test ends`,
      409,
    );
  }
}

function parseDefinition(input: Record<string, unknown>): ExperimentDefinition {
  const channel = parseConfigChannel(input.channel);
  const validation = validateExperimentDefinition(input, channel);
  if (!validation.ok) throw invalid(validation.error);
  return validation.definition;
}

function definitionData(definition: ExperimentDefinition) {
  return {
    key: definition.key,
    name: definition.name,
    channel: definition.channel,
    channelKey: configChannelKey(definition.channel),
    audienceChannels:
      definition.audienceChannels === null
        ? Prisma.DbNull
        : (definition.audienceChannels as Prisma.InputJsonValue),
    runtimeVersions: definition.runtimeVersions,
    trafficPercent: definition.trafficPercent,
    variants: definition.variants as unknown as Prisma.InputJsonValue,
    goalEvent: definition.goalEvent,
    secondaryEvents: definition.secondaryEvents,
  };
}

/** Create a draft. Nothing reaches devices until it starts. */
export async function createExperiment(
  context: Context,
  input: Record<string, unknown>,
): Promise<ExperimentSummary> {
  const definition = parseDefinition(input);
  const created = await db.$transaction(async (tx) => {
    await ensureApp(tx, context.organizationId, context.appId);
    await lockTransaction(tx, appLock(context.appId));
    await ensureKeyFree(tx, context.appId, definition.key);
    const active = await tx.experiment.count({
      where: { appId: context.appId, status: { in: ['draft', 'running'] } },
    });
    if (active >= MAX_ACTIVE_PER_APP) {
      throw new OtaKitServiceError(
        'EXPERIMENT_LIMIT_REACHED',
        `An app can have ${MAX_ACTIVE_PER_APP} draft and running A/B tests; delete unused drafts first`,
        409,
      );
    }
    return tx.experiment.create({
      data: {
        appId: context.appId,
        ...definitionData(definition),
        createdBy: context.actor.actorLabel,
      },
    });
  }, TRANSACTION_OPTIONS);
  await recordAuditLog({
    organizationId: context.organizationId,
    actor: context.actor,
    action: 'experiment.created',
    targetType: 'experiment',
    targetId: created.id,
    metadata: {
      appId: context.appId,
      key: created.key,
      channel: created.channel,
      ...context.auditMetadata,
    },
  });
  return toExperimentSummary(created);
}

const LOCKED_FIELDS = [
  'key',
  'channel',
  'audienceChannels',
  'runtimeVersions',
  'trafficPercent',
  'variants',
  'goalEvent',
  'secondaryEvents',
] as const;

/**
 * Change a draft (any field), or rename a test that started: what devices
 * use is locked while it runs, so results stay valid.
 */
export async function updateExperiment(
  context: Context,
  idOrKey: unknown,
  input: Record<string, unknown>,
): Promise<ExperimentSummary> {
  const updated = await db.$transaction(async (tx) => {
    await ensureApp(tx, context.organizationId, context.appId);
    await lockTransaction(tx, appLock(context.appId));
    const row = await findExperiment(tx, context, idOrKey);
    const current = definitionOf(row);
    const next = parseDefinition({
      ...current,
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    });
    if (row.status !== 'draft') {
      const changed = LOCKED_FIELDS.filter(
        (field) => JSON.stringify(next[field]) !== JSON.stringify(current[field]),
      );
      if (changed.length > 0) {
        throw new OtaKitServiceError(
          'EXPERIMENT_STATE',
          `Only the name of an A/B test that started can change (not ${changed.join(', ')}). Stop it and create a new test instead.`,
          409,
        );
      }
      return tx.experiment.update({ where: { id: row.id }, data: { name: next.name } });
    }
    if (next.key !== row.key) await ensureKeyFree(tx, context.appId, next.key, row.id);
    return tx.experiment.update({ where: { id: row.id }, data: definitionData(next) });
  }, TRANSACTION_OPTIONS);
  await recordAuditLog({
    organizationId: context.organizationId,
    actor: context.actor,
    action: 'experiment.updated',
    targetType: 'experiment',
    targetId: updated.id,
    metadata: { appId: context.appId, key: updated.key, ...context.auditMetadata },
  });
  return toExperimentSummary(updated);
}

/** Delete a test that is not running; its results go with it. */
export async function deleteExperiment(
  context: Context,
  idOrKey: unknown,
): Promise<{ deleted: true; id: string }> {
  const deleted = await db.$transaction(async (tx) => {
    await ensureApp(tx, context.organizationId, context.appId);
    await lockTransaction(tx, appLock(context.appId));
    const row = await findExperiment(tx, context, idOrKey);
    if (row.status === 'running') {
      throw new OtaKitServiceError(
        'EXPERIMENT_STATE',
        'This A/B test is running; stop it before deleting it',
        409,
      );
    }
    await tx.experiment.delete({ where: { id: row.id } });
    return row;
  }, TRANSACTION_OPTIONS);
  await recordAuditLog({
    organizationId: context.organizationId,
    actor: context.actor,
    action: 'experiment.deleted',
    targetType: 'experiment',
    targetId: deleted.id,
    metadata: {
      appId: context.appId,
      key: deleted.key,
      status: deleted.status,
      ...context.auditMetadata,
    },
  });
  return { deleted: true, id: deleted.id };
}

/** Running A/B tests per app on the workspace's plan; self-hosted servers have no limit. */
async function runningLimit(organizationId: string): Promise<number> {
  if (!isPolarConfigured()) return Number.MAX_SAFE_INTEGER;
  return (await getOrganizationEntitlements(organizationId)).limits.runningExperiments;
}

/** The running experiments of a config file, in start order. */
async function runningOnFile(
  tx: Prisma.TransactionClient,
  appId: string,
  channel: string | null,
  exceptId?: string,
): Promise<Experiment[]> {
  return tx.experiment.findMany({
    where: {
      appId,
      channelKey: configChannelKey(channel),
      status: 'running',
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
  });
}

function experimentsText(running: Experiment[]): string | null {
  const json = buildExperimentsJson(running.map(deviceExperiment));
  if (experimentsJsonBytes(json) > MAX_EXPERIMENTS_JSON_BYTES) {
    throw invalid(
      `The A/B tests on this config would be over ${MAX_EXPERIMENTS_JSON_BYTES / 1024} KiB together; use fewer or smaller overrides`,
    );
  }
  return json;
}

export type ExperimentChangeResult = {
  experiment: ExperimentSummary;
  /** The config version that carries the change, or null when the config did not change. */
  configVersion: number | null;
  /** Whether the CDN config file already has the change. */
  publicationStatus: 'published' | 'pending';
};

/**
 * Start a draft: devices that read its config file get their variant from
 * the next config fetch (at launch or on resume).
 */
export async function startExperiment(
  context: Context,
  idOrKey: unknown,
): Promise<ExperimentChangeResult> {
  const limit = await runningLimit(context.organizationId);
  const committed = await db.$transaction(async (tx) => {
    await ensureApp(tx, context.organizationId, context.appId);
    await lockTransaction(tx, appLock(context.appId));
    const row = await findExperiment(tx, context, idOrKey);
    if (row.status !== 'draft') {
      throw new OtaKitServiceError(
        'EXPERIMENT_STATE',
        `This A/B test is ${row.status}; only a draft can start. Create a new test to run it again.`,
        409,
      );
    }
    const running = await tx.experiment.count({
      where: { appId: context.appId, status: 'running' },
    });
    if (running >= limit) {
      throw limit === 0
        ? new OtaKitServiceError(
            'PLAN_REQUIRED',
            'A/B tests need a paid plan',
            403,
            'Upgrade in Settings → Billing.',
          )
        : new OtaKitServiceError(
            'EXPERIMENT_LIMIT_REACHED',
            `Your plan runs ${limit} A/B ${limit === 1 ? 'test' : 'tests'} at a time per app; stop one first or upgrade`,
            403,
          );
    }
    const file = await lockConfigFile(tx, context.appId, row.channel);
    if (row.channel !== null && file.status !== 'live') {
      throw new OtaKitServiceError(
        'CONFIG_REQUIRED',
        `The ${row.channel} channel has no config of its own: its devices read the base config. Run the test on the base config with ${row.channel} as the audience, or publish a config for ${row.channel} first.`,
        409,
      );
    }
    const others = await runningOnFile(tx, context.appId, row.channel, row.id);
    if (others.length >= MAX_RUNNING_PER_FILE) {
      throw new OtaKitServiceError(
        'EXPERIMENT_LIMIT_REACHED',
        `${configLabel(row.channel)} already has ${MAX_RUNNING_PER_FILE} running A/B tests`,
        409,
      );
    }
    for (const other of others) {
      const shared = sharedOverrideKeys(variantsOf(row), variantsOf(other));
      if (shared.length > 0) {
        throw new OtaKitServiceError(
          'EXPERIMENT_CONFLICT',
          `The running A/B test "${other.key}" already overrides ${shared.map((key) => `"${key}"`).join(', ')} on ${configLabel(row.channel)}; a key can be in one running test at a time`,
          409,
        );
      }
    }
    const started = await tx.experiment.update({
      where: { id: row.id },
      data: {
        status: 'running',
        startedAt: new Date(),
        stoppedAt: null,
        notifiedVerdict: null,
        resultsCheckedAt: null,
      },
    });
    const write = await writeConfigFileVersion(tx, context, {
      channel: row.channel,
      file,
      experimentsJson: experimentsText([...others, started]),
      message: `Started A/B test ${row.key}`,
    });
    const notified = await emitNotification(tx, {
      type: 'experiment.started',
      key: `experiment.started:${started.id}`,
      organizationId: context.organizationId,
      appId: context.appId,
      actor: context.actor,
      dashboardParams: { experiment: started.id },
      data: { experiment: notificationExperiment(started) },
    });
    return { experiment: started, version: write.version, notified };
  }, TRANSACTION_OPTIONS);
  return afterChange(context, committed, 'experiment.started');
}

/** Stop a running test: its devices get the normal config values on their next fetch. */
export async function stopExperiment(
  context: Context,
  idOrKey: unknown,
): Promise<ExperimentChangeResult> {
  const committed = await db.$transaction(async (tx) => {
    await ensureApp(tx, context.organizationId, context.appId);
    await lockTransaction(tx, appLock(context.appId));
    const row = await findExperiment(tx, context, idOrKey);
    if (row.status !== 'running') {
      throw new OtaKitServiceError(
        'EXPERIMENT_STATE',
        `This A/B test is ${row.status}; only a running test can stop`,
        409,
      );
    }
    const file = await lockConfigFile(tx, context.appId, row.channel);
    const stopped = await tx.experiment.update({
      where: { id: row.id },
      data: { status: 'stopped', stoppedAt: new Date() },
    });
    const write = await writeConfigFileVersion(tx, context, {
      channel: row.channel,
      file,
      experimentsJson: experimentsText(await runningOnFile(tx, context.appId, row.channel)),
      message: `Stopped A/B test ${row.key}`,
    });
    const notified = await emitNotification(tx, {
      type: 'experiment.stopped',
      key: `experiment.stopped:${stopped.id}`,
      organizationId: context.organizationId,
      appId: context.appId,
      actor: context.actor,
      dashboardParams: { experiment: stopped.id },
      data: { experiment: notificationExperiment(stopped) },
    });
    return { experiment: stopped, version: write.version, notified };
  }, TRANSACTION_OPTIONS);
  return afterChange(context, committed, 'experiment.stopped');
}

/**
 * Ship a variant of a running or stopped test: its overrides become part of
 * the config file's values for every device, and the test ends. Shipping
 * control keeps the values.
 */
export async function shipExperimentVariant(
  context: Context,
  idOrKey: unknown,
  input: { variant: unknown },
): Promise<ExperimentChangeResult & { changedKeys: string[] }> {
  if (typeof input.variant !== 'string' || !EXPERIMENT_KEY_PATTERN.test(input.variant)) {
    throw invalid('variant must be the key of one of the test variants');
  }
  const variantKey = input.variant;
  let changedKeys: string[] = [];
  let configNotified = 0;
  let configChange: {
    version: number;
    changes: { added: string[]; changed: string[]; removed: string[] };
  } | null = null;
  const committed = await db.$transaction(async (tx) => {
    await ensureApp(tx, context.organizationId, context.appId);
    await lockTransaction(tx, appLock(context.appId));
    const row = await findExperiment(tx, context, idOrKey);
    if (row.status !== 'running' && row.status !== 'stopped') {
      throw new OtaKitServiceError(
        'EXPERIMENT_STATE',
        row.status === 'draft'
          ? 'This A/B test has not started; there is nothing to ship yet'
          : `This A/B test already shipped ${row.shippedVariant ?? 'a variant'}`,
        409,
      );
    }
    const variant = variantsOf(row).find((item) => item.key === variantKey);
    if (!variant) {
      throw invalid(
        `"${variantKey}" is not a variant of this test (${variantsOf(row)
          .map((item) => item.key)
          .join(', ')})`,
      );
    }
    const file = await lockConfigFile(tx, context.appId, row.channel);
    const overrides = Object.entries(variant.overrides);
    let values: { valuesJson: string; values: ConfigValues } | undefined;
    if (overrides.length > 0) {
      if (row.channel !== null && file.status !== 'live') {
        throw new OtaKitServiceError(
          'CONFIG_REQUIRED',
          `The ${row.channel} channel has no config of its own anymore; publish one before shipping a variant into it`,
          409,
        );
      }
      const merged: ConfigValues = { ...(file.values ?? {}) };
      for (const [key, value] of overrides) {
        // defineProperty, so a key can never reach the prototype.
        Object.defineProperty(merged, key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      const validation = validateConfigValues(merged);
      if (!validation.ok) throw invalid(`The shipped config would be invalid: ${validation.error}`);
      if (validation.valuesJson !== file.valuesJson) {
        values = { valuesJson: validation.valuesJson, values: validation.values };
      }
    }
    const wasRunning = row.status === 'running';
    const shipped = await tx.experiment.update({
      where: { id: row.id },
      data: {
        status: 'shipped',
        shippedVariant: variant.key,
        stoppedAt: row.stoppedAt ?? new Date(),
      },
    });
    let version: number | null = null;
    if (wasRunning || values) {
      const write = await writeConfigFileVersion(tx, context, {
        channel: row.channel,
        file,
        experimentsJson: experimentsText(await runningOnFile(tx, context.appId, row.channel)),
        values,
        message: `Shipped ${variant.key} of A/B test ${row.key}`,
      });
      version = write.version;
      if (write.changedKeys) {
        changedKeys = [...write.changedKeys.changed, ...write.changedKeys.added];
        configChange = { version: write.version, changes: write.changedKeys };
      }
      configNotified = write.notified;
    }
    const notified = await emitNotification(tx, {
      type: 'experiment.stopped',
      key: `experiment.shipped:${shipped.id}`,
      organizationId: context.organizationId,
      appId: context.appId,
      actor: context.actor,
      dashboardParams: { experiment: shipped.id },
      data: { experiment: notificationExperiment(shipped) },
    });
    return { experiment: shipped, version, notified };
  }, TRANSACTION_OPTIONS);
  if (configNotified > 0) scheduleNotificationDelivery();
  if (configChange) {
    const change: {
      version: number;
      changes: { added: string[]; changed: string[]; removed: string[] };
    } = configChange;
    await recordAuditLog({
      organizationId: context.organizationId,
      actor: context.actor,
      action: 'config.published',
      targetType: 'remote_config',
      targetId: `${context.appId}:${configChannelKey(committed.experiment.channel)}`,
      metadata: {
        appId: context.appId,
        channel: committed.experiment.channel,
        version: change.version,
        message: `Shipped ${variantKey} of A/B test ${committed.experiment.key}`,
        ...change.changes,
        experimentId: committed.experiment.id,
        ...context.auditMetadata,
      },
    });
  }
  return { ...(await afterChange(context, committed, 'experiment.shipped')), changedKeys };
}

async function afterChange(
  context: Context,
  committed: { experiment: Experiment; version: number | null; notified: number },
  action: 'experiment.started' | 'experiment.stopped' | 'experiment.shipped',
): Promise<ExperimentChangeResult> {
  const { experiment, version } = committed;
  await recordAuditLog({
    organizationId: context.organizationId,
    actor: context.actor,
    action,
    targetType: 'experiment',
    targetId: experiment.id,
    metadata: {
      appId: context.appId,
      key: experiment.key,
      channel: experiment.channel,
      configVersion: version,
      ...(experiment.shippedVariant ? { variant: experiment.shippedVariant } : {}),
      ...context.auditMetadata,
    },
  });
  const publicationStatus =
    version === null ? 'published' : await syncRemoteConfigFile(context.appId, experiment.channel);
  if (committed.notified > 0) scheduleNotificationDelivery();
  return {
    experiment: toExperimentSummary(experiment),
    configVersion: version,
    publicationStatus,
  };
}

export type ExperimentSeriesPoint = {
  /** UTC day. */
  day: string;
  /** Cumulative devices up to and including the day. */
  variants: Array<{ key: string; exposed: number; converted: number }>;
};

export type ExperimentResults = {
  experiment: ExperimentSummary;
  /** Null before the test starts. */
  stats: ExperimentStats | null;
  /** Days (with fractions) from the start to the stop, or to now. */
  daysRunning: number;
  series: ExperimentSeriesPoint[];
  /** Custom events were paused by the plan limit during the test: results are incomplete. */
  analyticsPausedUntil: string | null;
  analyticsAvailable: boolean;
};

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function countsFrom(
  experiment: Experiment,
  rows: ExperimentReportRow[],
): Array<{
  key: string;
  exposed: number;
  converted: number;
  errors: number;
  secondary: Record<string, number>;
}> {
  return variantsOf(experiment).map((variant) => {
    const of = (name: string, goal = '') =>
      rows
        .filter((row) => row.variant === variant.key && row.name === name && row.goal === goal)
        .reduce((sum, row) => sum + row.reports, 0);
    return {
      key: variant.key,
      exposed: of(EXPOSURE),
      converted: of(CONVERSION, experiment.goalEvent),
      errors: of(EXPERIMENT_ERROR),
      secondary: Object.fromEntries(
        experiment.secondaryEvents.map((goal) => [goal, of(CONVERSION, goal)]),
      ),
    };
  });
}

async function computeResults(
  organizationId: string,
  experiment: Experiment,
  now: Date,
): Promise<ExperimentResults> {
  const summary = toExperimentSummary(experiment);
  if (!experiment.startedAt) {
    return {
      experiment: summary,
      stats: null,
      daysRunning: 0,
      series: [],
      analyticsPausedUntil: null,
      analyticsAvailable: true,
    };
  }
  const end = experiment.stoppedAt ?? now;
  const range = {
    appId: experiment.appId,
    experimentId: experiment.id,
    fromDay: utcDay(experiment.startedAt),
    toDay: utcDay(end),
  };
  const [totals, daily, usage] = await Promise.all([
    getExperimentReports(range),
    getExperimentReports({ ...range, daily: true }),
    getTelemetryUsageStatus(organizationId, 'event', now),
  ]);
  const daysRunning = Math.max(0, (end.getTime() - experiment.startedAt.getTime()) / DAY_MS);
  const stats = analyzeExperiment({
    variants: countsFrom(experiment, totals.data),
    daysRunning,
    seed: experiment.id,
  });

  const keys = variantsOf(experiment).map((variant) => variant.key);
  const running = new Map(keys.map((key) => [key, { exposed: 0, converted: 0 }]));
  const byDay = new Map<string, ExperimentReportRow[]>();
  for (const row of daily.data) {
    if (!row.day) continue;
    byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
  }
  const series: ExperimentSeriesPoint[] = [];
  for (
    let day = Date.parse(`${range.fromDay}T00:00:00.000Z`);
    day <= Date.parse(`${range.toDay}T00:00:00.000Z`);
    day += DAY_MS
  ) {
    const key = new Date(day).toISOString().slice(0, 10);
    for (const row of byDay.get(key) ?? []) {
      const totalsOfVariant = running.get(row.variant);
      if (!totalsOfVariant) continue;
      if (row.name === EXPOSURE) totalsOfVariant.exposed += row.reports;
      if (row.name === CONVERSION && row.goal === experiment.goalEvent) {
        totalsOfVariant.converted += row.reports;
      }
    }
    series.push({
      day: key,
      variants: keys.map((variant) => ({ key: variant, ...running.get(variant)! })),
    });
  }
  return {
    experiment: summary,
    stats,
    daysRunning: Math.round(daysRunning * 10) / 10,
    series,
    analyticsPausedUntil: usage.pausedUntil,
    analyticsAvailable: totals.available && daily.available,
  };
}

/** Results with statistics, a verdict and the cumulative series. */
export async function getExperimentResults(
  ctx: ReadContext,
  idOrKey: unknown,
  now: Date = new Date(),
): Promise<ExperimentResults> {
  await ensureApp(db, ctx.organizationId, ctx.appId);
  const experiment = await findExperiment(db, ctx, idOrKey);
  return computeResults(ctx.organizationId, experiment, now);
}

export type ExperimentEstimate = {
  /** App launches per day in the last 14 days ($session_start), on the channel or all channels. */
  launchesPerDay: number | null;
  /** Share of those launches with the goal event. */
  goalShare: number | null;
  /** Devices per variant to detect a 20% change, from goalShare: a rough guide. */
  plannedPerVariant: number | null;
  analyticsAvailable: boolean;
};

const HOUR_MS = 3_600_000;

/** A rough sample size for the create dialog, from the last 14 days of events (to now). */
export async function estimateExperiment(
  ctx: ReadContext,
  input: { channel?: unknown; goalEvent: unknown },
  now: Date = new Date(),
): Promise<ExperimentEstimate> {
  if (typeof input.goalEvent !== 'string' || !GOAL_EVENT_PATTERN.test(input.goalEvent)) {
    throw invalid('goalEvent must be a custom event name');
  }
  const channel =
    input.channel === undefined || input.channel === ''
      ? undefined
      : parseConfigChannel(input.channel);
  await ensureApp(db, ctx.organizationId, ctx.appId);
  // Hourly counts: through the current hour, 14 days back.
  const to = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS);
  const from = new Date(to.getTime() - 14 * DAY_MS);
  const window = { appId: ctx.appId, channel, from, to, previousFrom: from };
  const [launches, goal] = await Promise.all([
    listAppEventNames({ ...window, name: '$session_start' }),
    listAppEventNames({ ...window, name: input.goalEvent }),
  ]);
  const launchCount = launches.data[0]?.sessions ?? 0;
  const goalSessions = goal.data[0]?.sessions ?? 0;
  const goalShare = launchCount > 0 ? Math.min(1, goalSessions / launchCount) : null;
  return {
    launchesPerDay: launches.available && launchCount > 0 ? Math.round(launchCount / 14) : null,
    goalShare: goalShare === null ? null : Math.round(goalShare * 10_000) / 10_000,
    plannedPerVariant: plannedSamplePerVariant(goalShare),
    analyticsAvailable: launches.available && goal.available,
  };
}

function verdictKey(verdict: ExperimentVerdict): string | null {
  if (verdict.kind === 'winner' || verdict.kind === 'guardrail') {
    return `${verdict.kind}:${verdict.variant}`;
  }
  return verdict.kind === 'no_difference' ? 'no_difference' : null;
}

function notificationVerdict(verdict: ExperimentVerdict): NotificationExperimentVerdict | null {
  if (verdict.kind === 'winner' || verdict.kind === 'guardrail') {
    return { kind: verdict.kind, variant: verdict.variant, probability: verdict.probability };
  }
  return verdict.kind === 'no_difference' ? { kind: 'no_difference' } : null;
}

/**
 * Telemetry cron: read the results of running tests (each at most hourly) and
 * send experiment.verdict_reached once per new verdict.
 */
export async function checkExperimentVerdicts(
  now: Date = new Date(),
  database: PrismaClient = db,
): Promise<{ checked: number; notified: number }> {
  const due = await database.experiment.findMany({
    where: {
      status: 'running',
      OR: [
        { resultsCheckedAt: null },
        { resultsCheckedAt: { lt: new Date(now.getTime() - VERDICT_CHECK_MS) } },
      ],
    },
    include: { app: { select: { organizationId: true } } },
    orderBy: [{ resultsCheckedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: 20,
  });
  let notified = 0;
  for (const experiment of due) {
    const results = await computeResults(experiment.app.organizationId, experiment, now);
    if (!results.analyticsAvailable || !results.stats) continue;
    const verdict = notificationVerdict(results.stats.verdict);
    const key = verdictKey(results.stats.verdict);
    const variants: NotificationExperimentVariant[] = results.stats.variants.map((variant) => ({
      key: variant.key,
      exposed: variant.exposed,
      converted: variant.converted,
      rate: variant.rate,
      probabilityBest: variant.probabilityBest,
      errors: variant.errors,
    }));
    const sent = await database.$transaction(async (tx) => {
      // Only while still running and not already sent: a stop in between wins.
      const claimed = await tx.experiment.updateMany({
        where: {
          id: experiment.id,
          status: 'running',
          ...(key ? { OR: [{ notifiedVerdict: null }, { notifiedVerdict: { not: key } }] } : {}),
        },
        data: { resultsCheckedAt: now, ...(key ? { notifiedVerdict: key } : {}) },
      });
      if (claimed.count === 0 || !key || !verdict) return 0;
      return emitNotification(tx, {
        type: 'experiment.verdict_reached',
        key: `experiment.verdict:${experiment.id}:${key}`,
        organizationId: experiment.app.organizationId,
        appId: experiment.appId,
        actor: null,
        dashboardParams: { experiment: experiment.id },
        data: { experiment: notificationExperiment(experiment), verdict, variants },
      });
    });
    if (sent === 0 && key) {
      // Already sent this verdict: still record the check.
      await database.experiment.updateMany({
        where: { id: experiment.id, status: 'running' },
        data: { resultsCheckedAt: now },
      });
    }
    notified += sent;
  }
  if (notified > 0) scheduleNotificationDelivery();
  return { checked: due.length, notified };
}
