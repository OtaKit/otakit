import type { RemoteConfigHistoryEntry, RemoteConfigState } from './api.js';

/**
 * A value typed on the command line: JSON when it parses (`false`, `5`,
 * `{"a":1}`, `"quoted"`), otherwise the text itself, so URLs and words need
 * no extra quoting. A number that would not read back exactly as typed
 * (`1.10`, `2.0`, `1e3`, a huge integer) stays text. `--string` keeps the text
 * even when it looks like JSON.
 */
export function parseConfigValue(raw: string, asString = false): unknown {
  if (asString) return raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
  if (typeof parsed === 'number' && String(parsed) !== raw.trim()) return raw;
  return parsed;
}

/** "false (boolean)", "\"1.10\" (text)", for confirming what `set` stored. */
export function describeValue(value: unknown): string {
  const type =
    value === null
      ? 'null'
      : Array.isArray(value)
        ? 'list'
        : typeof value === 'string'
          ? 'text'
          : typeof value === 'object'
            ? 'object'
            : typeof value;
  const shown = JSON.stringify(value);
  return `${shown.length > 80 ? `${shown.slice(0, 79)}…` : shown} (${type})`;
}

export function keyCount(values: Record<string, unknown> | null): string {
  const count = Object.keys(values ?? {}).length;
  return `${count} ${count === 1 ? 'key' : 'keys'}`;
}

export function channelLabel(channel: string | null): string {
  return channel === null ? 'base channel' : `channel "${channel}"`;
}

/** Human-readable state of one channel's config. */
export function formatRemoteConfig(state: RemoteConfigState): string {
  if (state.status === 'none') {
    return state.channel === null
      ? 'The base channel has no remote config. Apps use their code defaults.'
      : `${channelLabel(state.channel)} has no config of its own. Its devices use the base channel's config.`;
  }
  if (state.status === 'deleted') {
    return [
      `${channelLabel(state.channel)}: config deleted in version ${state.version}${state.updatedBy ? ` by ${state.updatedBy}` : ''}.`,
      state.channel === null
        ? 'Apps use their code defaults.'
        : "Its devices use the base channel's config.",
    ].join('\n');
  }
  const lines = [
    `${channelLabel(state.channel)}: version ${state.version}${state.updatedBy ? `, by ${state.updatedBy}` : ''}${state.updatedAt ? ` (${state.updatedAt})` : ''}`,
  ];
  if (state.message) lines.push(`“${state.message}”`);
  if (state.publicationStatus === 'pending') {
    lines.push('Publishing to the CDN is pending; OtaKit retries within minutes.');
  }
  lines.push('', JSON.stringify(state.values ?? {}, null, 2));
  return lines.join('\n');
}

/** Added, changed and removed keys, for confirmations. */
export function describeKeyChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string {
  const previous = before ?? {};
  const added = Object.keys(after).filter((key) => !Object.hasOwn(previous, key));
  const changed = Object.keys(after).filter(
    (key) =>
      Object.hasOwn(previous, key) && JSON.stringify(previous[key]) !== JSON.stringify(after[key]),
  );
  const removed = Object.keys(previous).filter((key) => !Object.hasOwn(after, key));
  const parts = [
    added.length > 0 ? `add ${added.join(', ')}` : null,
    changed.length > 0 ? `change ${changed.join(', ')}` : null,
    removed.length > 0 ? `remove ${removed.join(', ')}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join('; ') : 'no changes';
}

export function formatRemoteConfigHistory(versions: RemoteConfigHistoryEntry[]): string {
  if (versions.length === 0) return 'No config history.';
  return versions
    .map((entry) => {
      const what = entry.deleted ? 'deleted' : keyCount(entry.values);
      const message = entry.message ? `  “${entry.message}”` : '';
      return `v${entry.version}  ${entry.createdAt}  ${entry.createdBy}  ${what}${message}`;
    })
    .join('\n');
}
