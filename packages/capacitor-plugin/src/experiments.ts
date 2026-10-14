import type {
  AppTelemetryItem,
  ExperimentContext,
  ExperimentReport,
  NativeRemoteConfig,
  OtaKitBridgePlugin,
  RemoteConfigValues,
} from './definitions';
import { isUnimplemented, type Telemetry } from './telemetry';

/**
 * A/B tests (plugin 3.4+). Running experiments arrive in the signed config
 * file. Each device gets a variant from its own buckets (computed natively
 * from a random secret that never leaves the device), sees that variant's
 * config overrides, and reports at most once per experiment: its exposure,
 * each goal after that, and its first error after that. OtaKit counts those
 * reports per variant, so results need no device identifier.
 */

export type ExperimentVariantDefinition = {
  key: string;
  weight: number;
  overrides: RemoteConfigValues;
};

export type ExperimentDefinition = {
  id: string;
  key: string;
  traffic: number;
  variants: ExperimentVariantDefinition[];
  goals: string[];
  channels: Array<string | null> | null;
  runtimeVersions: string[] | null;
};

export type ExperimentsNative = Pick<
  OtaKitBridgePlugin,
  'getConfig' | 'getExperimentContext' | 'reportExperiment'
>;

type Assignment = { definition: ExperimentDefinition; variant: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[a-z0-9_-]{1,40}$/;
const GOAL = /^(?=.*[A-Za-z0-9])[A-Za-z0-9_.:-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPercent(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 100;
}

function stringList(value: unknown): string[] | null | undefined {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined;
  return value as string[];
}

/** One experiment from the file, or null when anything about it is off (it is skipped). */
function parseDefinition(raw: unknown): ExperimentDefinition | null {
  if (!isRecord(raw)) return null;
  const { id, key, traffic, variants, goals } = raw;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (typeof key !== 'string' || !KEY.test(key)) return null;
  if (!isPercent(traffic, 1) || !Array.isArray(variants) || variants.length < 2) return null;
  const parsedVariants: ExperimentVariantDefinition[] = [];
  for (const variant of variants) {
    if (!isRecord(variant) || typeof variant.key !== 'string' || !KEY.test(variant.key)) {
      return null;
    }
    if (!isPercent(variant.weight, 1) || !isRecord(variant.overrides)) return null;
    parsedVariants.push({
      key: variant.key,
      weight: variant.weight,
      overrides: variant.overrides as RemoteConfigValues,
    });
  }
  if (parsedVariants.reduce((sum, variant) => sum + variant.weight, 0) !== 100) return null;
  const goalList = stringList(goals);
  if (!goalList || !goalList.every((goal) => GOAL.test(goal))) return null;
  const channels = raw.channels;
  if (
    channels !== null &&
    channels !== undefined &&
    (!Array.isArray(channels) ||
      !channels.every((channel) => channel === null || typeof channel === 'string'))
  ) {
    return null;
  }
  const runtimeVersions = stringList(raw.runtimeVersions);
  if (runtimeVersions === undefined) return null;
  return {
    id,
    key,
    traffic,
    variants: parsedVariants,
    goals: goalList,
    channels: (channels as Array<string | null> | null | undefined) ?? null,
    runtimeVersions,
  };
}

export function parseExperiments(json: string | null | undefined): ExperimentDefinition[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const definitions: ExperimentDefinition[] = [];
    for (const raw of parsed) {
      const definition = parseDefinition(raw);
      if (
        definition &&
        !definitions.some((other) => other.key === definition.key || other.id === definition.id)
      ) {
        definitions.push(definition);
      }
    }
    return definitions;
  } catch {
    return [];
  }
}

/**
 * The device's variant, or null when the device is outside the audience or
 * the traffic. Buckets are 1-100.
 */
export function assignVariant(
  definition: ExperimentDefinition,
  context: Pick<ExperimentContext, 'deviceChannel' | 'runtimeVersion' | 'buckets'>,
): string | null {
  if (definition.channels && !definition.channels.includes(context.deviceChannel)) return null;
  if (
    definition.runtimeVersions &&
    (context.runtimeVersion === null ||
      !definition.runtimeVersions.includes(context.runtimeVersion))
  ) {
    return null;
  }
  const bucket = context.buckets[definition.id];
  if (!bucket || bucket.traffic > definition.traffic) return null;
  let cumulative = 0;
  for (const variant of definition.variants) {
    cumulative += variant.weight;
    if (bucket.variant <= cumulative) return variant.key;
  }
  return null;
}

function overridesKeys(definition: ExperimentDefinition): boolean {
  return definition.variants.some((variant) => Object.keys(variant.overrides).length > 0);
}

export type Experiments = {
  /** Values with the device's variant overrides; reports exposure to config experiments. */
  applyToConfig(
    native: NativeRemoteConfig | null | undefined,
    values: RemoteConfigValues,
  ): Promise<RemoteConfigValues>;
  getVariant(key: string): Promise<string | null>;
  /** A tracked event: reports a goal of an experiment the device was exposed to. */
  onEvent(name: string): void;
  /** An error that error tracking sent. */
  onError(): void;
};

export function createExperiments(native: ExperimentsNative, telemetry: Telemetry): Experiments {
  let parsedJson: string | null = null;
  let definitions: ExperimentDefinition[] = [];
  /** The device's variants for the last config this page load read; null before the first read. */
  let current: Promise<Assignment[]> | null = null;
  const known = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();
  let off = false;

  function warnOff(error: unknown) {
    if (isUnimplemented(error)) {
      off = true;
      return;
    }
    telemetry.warnOnce('experiments', `Could not read experiments: ${String(error)}`);
  }

  async function assign(config: NativeRemoteConfig | null | undefined): Promise<Assignment[]> {
    if (off || !config || config.source === 'none') return [];
    const json = config.experimentsJson ?? null;
    if (json !== parsedJson) {
      parsedJson = json;
      definitions = parseExperiments(json);
    }
    if (definitions.length === 0) return [];
    const list = definitions;
    try {
      const context = await native.getExperimentContext({
        experimentIds: list.map((definition) => definition.id),
      });
      for (const [id, reports] of Object.entries(context.reported ?? {})) {
        for (const report of reports) known.add(`${id}:${report}`);
      }
      const assignments: Assignment[] = [];
      for (const definition of list) {
        const variant = assignVariant(definition, context);
        if (variant !== null) assignments.push({ definition, variant });
      }
      return assignments;
    } catch (error) {
      warnOff(error);
      return [];
    }
  }

  function load(config?: NativeRemoteConfig | null): Promise<Assignment[]> {
    if (config !== undefined) {
      current = assign(config);
    } else {
      current ??= native.getConfig().then(assign, (error: unknown) => {
        warnOff(error);
        return [];
      });
    }
    return current;
  }

  /**
   * Reports run one at a time in call order, so an exposure is stored before
   * a conversion that follows it.
   */
  function report(assignment: Assignment, kind: ExperimentReport, goal?: string) {
    const { definition, variant } = assignment;
    const flag = `${definition.id}:${kind}`;
    if (off || known.has(flag)) return;
    known.add(flag);
    const item: AppTelemetryItem = {
      kind: 'event',
      eventId: telemetry.env.uuid(),
      occurredAt: telemetry.env.now().toISOString(),
      name:
        kind === 'exposure' ? '$exposure' : kind === 'error' ? '$experiment_error' : '$conversion',
      properties: {
        experiment: definition.id,
        variant,
        ...(goal ? { goal } : {}),
      },
    };
    queue = queue.then(async () => {
      try {
        const bundle = telemetry.bundle();
        const result = await native.reportExperiment({
          experimentId: definition.id,
          report: kind,
          ...(kind === 'exposure' ? {} : { requires: 'exposure' as const }),
          item,
          ...(bundle ? { bundle } : {}),
        });
        // Not stored (no exposure yet, or the outbox is full): ask again next time.
        if (!result.reported && kind !== 'exposure') known.delete(flag);
      } catch (error) {
        known.delete(flag);
        warnOff(error);
      }
    });
  }

  return {
    async applyToConfig(config, values) {
      try {
        const assignments = await load(config);
        if (assignments.length === 0) return values;
        const result: RemoteConfigValues = { ...values };
        for (const assignment of assignments) {
          const variant = assignment.definition.variants.find(
            (item) => item.key === assignment.variant,
          );
          for (const [key, value] of Object.entries(variant?.overrides ?? {})) {
            Object.defineProperty(result, key, {
              value,
              enumerable: true,
              writable: true,
              configurable: true,
            });
          }
          if (overridesKeys(assignment.definition)) report(assignment, 'exposure');
        }
        return result;
      } catch {
        return values;
      }
    },
    async getVariant(key) {
      if (typeof key !== 'string') return null;
      try {
        const config = await native.getConfig();
        const assignment = (await load(config)).find((item) => item.definition.key === key);
        if (!assignment) return null;
        report(assignment, 'exposure');
        return assignment.variant;
      } catch (error) {
        warnOff(error);
        return null;
      }
    },
    onEvent(name) {
      if (off || !telemetry.env.isNative()) return;
      void load().then((assignments) => {
        for (const assignment of assignments) {
          if (assignment.definition.goals.includes(name)) {
            report(assignment, `conversion:${name}`, name);
          }
        }
      });
    },
    onError() {
      if (off || !telemetry.env.isNative()) return;
      void load().then((assignments) => {
        for (const assignment of assignments) report(assignment, 'error');
      });
    },
  };
}
