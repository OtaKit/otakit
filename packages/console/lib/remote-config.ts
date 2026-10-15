/**
 * Remote config rules shared by the server and the dashboard editor: what a
 * config may contain, how it is serialized, and which values look like
 * secrets. No server-only imports, so client components can use it.
 */

/** A channel's config is a JSON object of at most this many bytes (UTF-8). */
export const MAX_CONFIG_BYTES = 16 * 1024;
export const MAX_CONFIG_KEYS = 200;
export const MAX_CONFIG_MESSAGE_LENGTH = 200;
/** Top-level keys: what `values.someKey` can reach in app code without quoting. */
export const CONFIG_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
/** Keys that would reach object prototypes when apps merge config into objects. */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Storage and URL key of the base channel, as for manifests. */
export const BASE_CHANNEL_KEY = '__base__';

export function configChannelKey(channel: string | null): string {
  return channel ?? BASE_CHANNEL_KEY;
}

export type ConfigValues = Record<string, unknown>;

export type ConfigWarning = {
  key: string;
  /** experiment: devices of this channel leave A/B tests running on the base config. */
  reason: 'secret_name' | 'secret_value' | 'experiment';
  message: string;
};

export type ConfigValidation =
  | { ok: true; values: ConfigValues; valuesJson: string; warnings: ConfigWarning[] }
  | { ok: false; error: string };

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Plain JSON only: no functions, no NaN or Infinity, no undefined. */
function invalidValue(value: unknown, path: string): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : `${path} must be a finite number`;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const error = invalidValue(value[index], `${path}[${index}]`);
      if (error) return error;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const error = invalidValue(item, `${path}.${key}`);
      if (error) return error;
    }
    return null;
  }
  return `${path} is not a JSON value`;
}

const SECRET_WORDS = new Set([
  'secret',
  'token',
  'password',
  'passwd',
  'credential',
  'credentials',
  'apikey',
  'privatekey',
]);

/** Whole words of a key: `stripeSecretKey`, `API_KEY` and `auth-token` count; `tokensPerMonth` does not. */
function isSecretName(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some(
    (word, index) =>
      SECRET_WORDS.has(word) ||
      (word === 'key' && (words[index - 1] === 'api' || words[index - 1] === 'private')),
  );
}
const JWT = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const LONG_KEY_LIKE = /^(?:[A-Fa-f0-9]{40,}|[A-Za-z0-9+/_-]{40,}={0,2})$/;
const KEY_PREFIX = /^(sk|pk|rk)_(live|test)_|^(ghp|gho|github_pat|xox[abpr])_|^AKIA[0-9A-Z]{16}$/;

function looksLikeSecret(value: string): boolean {
  const text = value.trim();
  return JWT.test(text) || KEY_PREFIX.test(text) || (LONG_KEY_LIKE.test(text) && !/\s/.test(text));
}

/**
 * Keys named like secrets and top-level string values shaped like keys or
 * tokens. Config is public by design, so this warns before publishing; it does
 * not block.
 */
export function configSecretWarnings(values: ConfigValues): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (isSecretName(key)) {
      warnings.push({
        key,
        reason: 'secret_name',
        message: `"${key}" is named like a secret. Anyone with your app can read config values.`,
      });
    } else if (typeof value === 'string' && looksLikeSecret(value)) {
      warnings.push({
        key,
        reason: 'secret_value',
        message: `"${key}" looks like a key or token. Anyone with your app can read config values.`,
      });
    }
  }
  return warnings;
}

/**
 * Check a config object and serialize it. The serialization is the exact
 * text devices receive and the signature covers, so it is computed once here.
 */
export function validateConfigValues(input: unknown): ConfigValidation {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Config must be a JSON object, such as {"checkoutEnabled": true}' };
  }
  const values = input as ConfigValues;
  const keys = Object.keys(values);
  if (keys.length > MAX_CONFIG_KEYS) {
    return { ok: false, error: `Config can have at most ${MAX_CONFIG_KEYS} top-level keys` };
  }
  const badKey = keys.find((key) => !CONFIG_KEY_PATTERN.test(key));
  if (badKey !== undefined) {
    return {
      ok: false,
      error: `Invalid key "${badKey.slice(0, 80)}": use 1-64 letters, digits, ".", "_" or "-"`,
    };
  }
  const reserved = keys.find((key) => RESERVED_KEYS.has(key));
  if (reserved !== undefined) {
    return { ok: false, error: `"${reserved}" cannot be a config key` };
  }
  for (const key of keys) {
    const error = invalidValue(values[key], key);
    if (error) return { ok: false, error };
  }
  const valuesJson = JSON.stringify(values);
  if (utf8Length(valuesJson) > MAX_CONFIG_BYTES) {
    return {
      ok: false,
      error: `Config is ${utf8Length(valuesJson).toLocaleString('en-US')} bytes; the limit is ${MAX_CONFIG_BYTES.toLocaleString('en-US')}`,
    };
  }
  return { ok: true, values, valuesJson, warnings: configSecretWarnings(values) };
}

/** Changed, added and removed top-level keys between two configs. */
export function configKeyChanges(
  before: ConfigValues | null,
  after: ConfigValues,
): { added: string[]; changed: string[]; removed: string[] } {
  const previous = before ?? {};
  const added: string[] = [];
  const changed: string[] = [];
  for (const [key, value] of Object.entries(after)) {
    if (!Object.hasOwn(previous, key)) added.push(key);
    else if (JSON.stringify(previous[key]) !== JSON.stringify(value)) changed.push(key);
  }
  const removed = Object.keys(previous).filter((key) => !Object.hasOwn(after, key));
  return { added, changed, removed };
}
