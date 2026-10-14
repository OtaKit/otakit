/** The parts of a channel's config state (REST response or service result) the summaries read. */
type RemoteConfigStateLike = {
  channel: string | null;
  version: number;
  status: 'live' | 'deleted' | 'none';
  values: Record<string, unknown> | null;
  message: string | null;
  updatedBy: string | null;
  publicationStatus: 'published' | 'pending';
};

function where(channel: string | null): string {
  return channel === null ? 'the base channel' : `channel "${channel}"`;
}

function keyList(values: Record<string, unknown>): string {
  const keys = Object.keys(values);
  if (keys.length === 0) return 'no keys';
  const shown = keys.slice(0, 8).join(', ');
  return keys.length > 8 ? `${keys.length} keys (${shown}, …)` : `${keys.length} ${keys.length === 1 ? 'key' : 'keys'} (${shown})`;
}

/** One sentence for get_remote_config. */
export function remoteConfigSummary(state: RemoteConfigStateLike): string {
  if (state.status === 'none') {
    return state.channel === null
      ? 'The base channel has no remote config; apps use their code defaults.'
      : `${where(state.channel)} has no config of its own; its devices use the base channel's config.`;
  }
  if (state.status === 'deleted') {
    return state.channel === null
      ? `The base channel's config was deleted (version ${state.version}); apps use their code defaults.`
      : `The config of ${where(state.channel)} was deleted (version ${state.version}); its devices use the base channel's config.`;
  }
  const said = state.message ? `: “${state.message}”` : '';
  const by = state.updatedBy ? ` Last changed by ${state.updatedBy}${said}.` : '';
  return `Remote config of ${where(state.channel)}: version ${state.version}, ${keyList(state.values ?? {})}.${by}`;
}

/** Summary and warnings for set_remote_config. */
export function remoteConfigWriteParts(result: {
  config: RemoteConfigStateLike;
  changed: boolean;
  warnings: Array<{ message: string }>;
}): { summary: string; warnings: string[] } {
  const { config } = result;
  const warnings = result.warnings.map((warning) => warning.message);
  if (!result.changed) {
    return {
      summary: `Nothing changed: ${where(config.channel)} already has these values (version ${config.version}).`,
      warnings,
    };
  }
  if (config.publicationStatus === 'pending') {
    warnings.push(
      'The new version is saved, but writing its file to the CDN failed; OtaKit retries within minutes. Do not publish it again.',
    );
  }
  return {
    summary: `Published version ${config.version} of ${where(config.channel)}'s remote config. Apps on plugin 3.4+ get it on their next fetch (at launch, or on resume after checkInterval).`,
    warnings,
  };
}
