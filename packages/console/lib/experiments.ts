/**
 * Experiment rules shared by the server and the dashboard: what an experiment
 * may contain and the exact JSON devices receive inside the signed config
 * file. No server-only imports, so client components can use it.
 */

import { CONFIG_KEY_PATTERN, validateConfigValues, type ConfigValues } from '@/lib/remote-config';

// As in lib/validation.ts, which client components cannot import.
const CHANNEL_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const RUNTIME_VERSION = /^[A-Za-z0-9._-]{1,64}$/;

function isReleasableChannelName(channel: string): boolean {
  return CHANNEL_NAME.test(channel) && !channel.toLowerCase().startsWith('__preview');
}

export const EXPERIMENT_STATUSES = ['draft', 'running', 'stopped', 'shipped'] as const;
export type ExperimentStatusValue = (typeof EXPERIMENT_STATUSES)[number];

/** Experiment and variant keys, as used in app code: `getVariant('paywall_copy')`. */
export const EXPERIMENT_KEY_PATTERN = /^[a-z0-9_-]{1,40}$/;
/** Goal events are custom event names; `$` names are OtaKit's own. */
export const GOAL_EVENT_PATTERN = /^(?=.*[A-Za-z0-9])[A-Za-z0-9_.:-]{1,64}$/;
export const CONTROL_KEY = 'control';
export const MIN_VARIANTS = 2;
export const MAX_VARIANTS = 5;
export const MAX_SECONDARY_GOALS = 3;
export const MAX_NAME_LENGTH = 100;
export const MAX_AUDIENCE_ITEMS = 20;
/** Running experiments in one config file. */
export const MAX_RUNNING_PER_FILE = 10;
/** Overrides of one variant, serialized. */
export const MAX_OVERRIDES_BYTES = 8 * 1024;
/** The experiments text of one file; devices ignore config files over 64 KiB. */
export const MAX_EXPERIMENTS_JSON_BYTES = 32 * 1024;

export type ExperimentVariant = { key: string; weight: number; overrides: ConfigValues };

/** Everything that decides which devices are in an experiment and what they get. */
export type ExperimentDefinition = {
  key: string;
  name: string;
  /** The config file the experiment rides in; null = the base config. */
  channel: string | null;
  /** Devices whose channel is in the list (null = the base channel); null = every device of the file. */
  audienceChannels: Array<string | null> | null;
  /** Devices with one of these runtime versions; empty = every runtime version. */
  runtimeVersions: string[];
  trafficPercent: number;
  variants: ExperimentVariant[];
  goalEvent: string;
  secondaryEvents: string[];
};

export type DefinitionValidation =
  | { ok: true; definition: ExperimentDefinition }
  | { ok: false; error: string };

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWholeNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function validateVariants(input: unknown): ExperimentVariant[] | string {
  if (!Array.isArray(input) || input.length < MIN_VARIANTS || input.length > MAX_VARIANTS) {
    return `variants must list ${MIN_VARIANTS} to ${MAX_VARIANTS} variants, control first`;
  }
  const variants: ExperimentVariant[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of input.entries()) {
    if (!isRecord(raw)) return 'Each variant needs a key, a weight and overrides';
    const key = raw.key;
    if (typeof key !== 'string' || !EXPERIMENT_KEY_PATTERN.test(key)) {
      return 'Variant keys use 1-40 lowercase letters, digits, "_" or "-"';
    }
    if (seen.has(key)) return `Variant "${key}" is listed twice`;
    seen.add(key);
    if (index === 0 && key !== CONTROL_KEY) return 'The first variant must be "control"';
    if (index > 0 && key === CONTROL_KEY) return 'Only the first variant can be "control"';
    if (!isWholeNumber(raw.weight, 1, 99)) {
      return `The weight of "${key}" must be a whole percent from 1 to 99`;
    }
    const overridesInput = raw.overrides ?? {};
    if (!isRecord(overridesInput)) return `The overrides of "${key}" must be a JSON object`;
    if (key === CONTROL_KEY && Object.keys(overridesInput).length > 0) {
      return 'Control keeps the normal config values: it cannot have overrides';
    }
    const overrides = validateConfigValues(overridesInput);
    if (!overrides.ok) return `Overrides of "${key}": ${overrides.error}`;
    if (utf8Length(overrides.valuesJson) > MAX_OVERRIDES_BYTES) {
      return `The overrides of "${key}" are over ${MAX_OVERRIDES_BYTES / 1024} KiB`;
    }
    variants.push({ key, weight: raw.weight, overrides: overrides.values });
  }
  const total = variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (total !== 100) return `Variant weights must add up to 100 (they add up to ${total})`;
  return variants;
}

function validateAudienceChannels(
  input: unknown,
  channel: string | null,
): Array<string | null> | null | string {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_AUDIENCE_ITEMS) {
    return `audienceChannels must be null or a list of 1 to ${MAX_AUDIENCE_ITEMS} channels`;
  }
  if (channel !== null) {
    return 'Only experiments on the base config can choose channels: a channel config reaches only its own channel';
  }
  const result: Array<string | null> = [];
  for (const value of input) {
    if (value !== null && (typeof value !== 'string' || !isReleasableChannelName(value))) {
      return 'audienceChannels lists channel names, or null for the base channel';
    }
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

function validateRuntimeVersions(input: unknown): string[] | string {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > MAX_AUDIENCE_ITEMS) {
    return `runtimeVersions must be a list of at most ${MAX_AUDIENCE_ITEMS} versions`;
  }
  const result: string[] = [];
  for (const value of input) {
    if (typeof value !== 'string' || !RUNTIME_VERSION.test(value)) {
      return 'runtimeVersions lists runtime versions: 1-64 letters, digits, ".", "_" or "-"';
    }
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

function validateGoals(
  goalInput: unknown,
  secondaryInput: unknown,
): { goalEvent: string; secondaryEvents: string[] } | string {
  if (typeof goalInput !== 'string' || !GOAL_EVENT_PATTERN.test(goalInput)) {
    return 'goalEvent must be a custom event name, such as purchase_completed';
  }
  const secondary = secondaryInput ?? [];
  if (!Array.isArray(secondary) || secondary.length > MAX_SECONDARY_GOALS) {
    return `secondaryEvents must be a list of at most ${MAX_SECONDARY_GOALS} event names`;
  }
  const secondaryEvents: string[] = [];
  for (const value of secondary) {
    if (typeof value !== 'string' || !GOAL_EVENT_PATTERN.test(value)) {
      return 'secondaryEvents lists custom event names';
    }
    if (value !== goalInput && !secondaryEvents.includes(value)) secondaryEvents.push(value);
  }
  return { goalEvent: goalInput, secondaryEvents };
}

/**
 * Check a whole experiment definition. `channel` is already parsed (the config
 * file); the rest comes from the request.
 */
export function validateExperimentDefinition(
  input: Record<string, unknown>,
  channel: string | null,
): DefinitionValidation {
  const key = input.key;
  if (typeof key !== 'string' || !EXPERIMENT_KEY_PATTERN.test(key)) {
    return { ok: false, error: 'key must be 1-40 lowercase letters, digits, "_" or "-"' };
  }
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `name must be 1-${MAX_NAME_LENGTH} characters` };
  }
  const audienceChannels = validateAudienceChannels(input.audienceChannels, channel);
  if (typeof audienceChannels === 'string') return { ok: false, error: audienceChannels };
  const runtimeVersions = validateRuntimeVersions(input.runtimeVersions);
  if (typeof runtimeVersions === 'string') return { ok: false, error: runtimeVersions };
  const trafficPercent = input.trafficPercent ?? 100;
  if (!isWholeNumber(trafficPercent, 1, 100)) {
    return { ok: false, error: 'trafficPercent must be a whole percent from 1 to 100' };
  }
  const variants = validateVariants(input.variants);
  if (typeof variants === 'string') return { ok: false, error: variants };
  const goals = validateGoals(input.goalEvent, input.secondaryEvents);
  if (typeof goals === 'string') return { ok: false, error: goals };
  return {
    ok: true,
    definition: {
      key,
      name,
      channel,
      audienceChannels,
      runtimeVersions,
      trafficPercent,
      variants,
      ...goals,
    },
  };
}

/** Config keys any variant of the experiment overrides. */
export function overriddenKeys(variants: ExperimentVariant[]): string[] {
  return Array.from(new Set(variants.flatMap((variant) => Object.keys(variant.overrides)))).sort();
}

/** Keys two experiments both override; running experiments of one file may not share any. */
export function sharedOverrideKeys(
  left: ExperimentVariant[],
  right: ExperimentVariant[],
): string[] {
  const other = new Set(overriddenKeys(right));
  return overriddenKeys(left).filter((key) => other.has(key));
}

export type DeviceExperiment = Pick<
  ExperimentDefinition,
  | 'key'
  | 'trafficPercent'
  | 'variants'
  | 'goalEvent'
  | 'secondaryEvents'
  | 'audienceChannels'
  | 'runtimeVersions'
> & { id: string };

/**
 * The exact `experimentsJson` text of a config file: its running experiments
 * in start order, or null without any. Field order is fixed so the same
 * experiments always give the same bytes.
 */
export function buildExperimentsJson(experiments: DeviceExperiment[]): string | null {
  if (experiments.length === 0) return null;
  return JSON.stringify(
    experiments.map((experiment) => ({
      id: experiment.id,
      key: experiment.key,
      traffic: experiment.trafficPercent,
      variants: experiment.variants.map((variant) => ({
        key: variant.key,
        weight: variant.weight,
        overrides: variant.overrides,
      })),
      goals: [experiment.goalEvent, ...experiment.secondaryEvents],
      channels: experiment.audienceChannels,
      runtimeVersions: experiment.runtimeVersions.length > 0 ? experiment.runtimeVersions : null,
    })),
  );
}

export function experimentsJsonBytes(json: string | null): number {
  return json === null ? 0 : utf8Length(json);
}

/** Valid config keys only; used by the dashboard's override editor. */
export function isConfigKey(key: string): boolean {
  return CONFIG_KEY_PATTERN.test(key);
}
