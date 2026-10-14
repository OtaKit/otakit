/** The parts of a bundle diff (REST response or service result) the summary reads. */
type BundleDiffLike = {
  target: { version: string; strategy?: string };
  base: { version: string } | null;
  baseSource?: 'against' | 'channel' | 'channel_previous' | 'previous_upload';
  baseChannel?: string | null;
  status: 'ok' | 'target_unavailable' | 'base_unavailable';
  unavailableReason: 'encrypted' | 'unreadable' | null;
  comparable: boolean;
  summary: {
    added: number;
    removed: number;
    changed: number;
    totalBefore: number | null;
    totalAfter: number;
    downloadBytes: number | null;
  } | null;
};

/** A full diff as the REST API and the console service return it. */
type FullBundleDiffLike = BundleDiffLike & {
  changes: Array<{ path: string }>;
  unlistedChanges: number;
  warnings: Array<{
    severity: 'warning' | 'note';
    message: string;
    paths: string[];
    count: number;
  }>;
};

/** Agents get the summary and the first files; the CLI and REST have the full list. */
export const AGENT_LISTED_CHANGES = 100;

/** "980 B", "38.0 KB", "4.1 MB". */
export function formatBundleBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// C0/C1 controls, line and paragraph separators, and bidirectional overrides
// (which can make a file name read differently than it is).
// eslint-disable-next-line no-control-regex
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/**
 * File names come from uploaded archives: escape characters that could move a
 * terminal's cursor, color it, or reorder the text.
 */
export function printablePath(path: string): string {
  return path.replace(
    UNPRINTABLE,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

const UNAVAILABLE: Record<'encrypted' | 'unreadable', string> = {
  encrypted: 'it is encrypted',
  unreadable: 'its files could not be read',
};

/**
 * One line for a bundle comparison, e.g.
 * "1.4.2 vs 1.4.1: +3 ~12 -1 · 4.1 MB → 4.3 MB · devices on 1.4.1 download up to 38.0 KB".
 * `baseLabel` names the base differently, such as "production (1.4.1)".
 */
export function describeBundleDiff(
  diff: BundleDiffLike,
  options: { baseLabel?: string } = {},
): string {
  const reason = UNAVAILABLE[diff.unavailableReason ?? 'unreadable'];
  if (diff.status === 'target_unavailable') {
    return `Cannot list the files of ${diff.target.version}: ${reason}.`;
  }
  if (diff.status === 'base_unavailable' || !diff.summary) {
    return `Cannot compare ${diff.target.version} with ${diff.base?.version ?? 'its base'}: ${reason}.`;
  }
  const { summary } = diff;
  if (!diff.base) {
    return `${diff.target.version}: ${summary.added} files (${formatBundleBytes(summary.totalAfter)}), nothing earlier to compare with.`;
  }
  // Zip updates download the whole archive. Delta updates download only content
  // the device does not have; it may already have more than the base (its
  // fallback or a staged bundle), so the figure is an upper bound.
  const download =
    summary.downloadBytes === null
      ? 'devices download up to the full bundle'
      : diff.target.strategy === 'deltas'
        ? `devices on ${diff.base.version} download up to ${formatBundleBytes(summary.downloadBytes)}`
        : `devices download ${formatBundleBytes(summary.downloadBytes)}, the whole archive`;
  const parts = [
    `+${summary.added} ~${summary.changed} -${summary.removed}`,
    `${formatBundleBytes(summary.totalBefore ?? 0)} → ${formatBundleBytes(summary.totalAfter)}`,
    download,
  ];
  const caveat = diff.comparable
    ? ''
    : '; compared by size, as one bundle is zip and the other deltas';
  const channel = diff.baseChannel === null ? 'base' : diff.baseChannel;
  const baseLabel =
    options.baseLabel ??
    (diff.baseSource === 'previous_upload'
      ? `${diff.base.version} (previous upload)`
      : diff.baseSource === 'channel' && channel !== undefined
        ? `${channel} (${diff.base.version})`
        : diff.baseSource === 'channel_previous' && channel !== undefined
          ? `${diff.base.version} (what ${channel} ran before it)`
          : diff.base.version);
  return `${diff.target.version} vs ${baseLabel}: ${parts.join(' · ')}${caveat}`;
}

function warningLine(warning: FullBundleDiffLike['warnings'][number]): string {
  const paths = warning.paths.map(printablePath).join(', ');
  const more =
    warning.count > warning.paths.length ? ` and ${warning.count - warning.paths.length} more` : '';
  return paths ? `${warning.message} ${paths}${more}` : warning.message;
}

/**
 * The `diff_bundles` result for agents: the summary, the first
 * AGENT_LISTED_CHANGES files (a first upload of a large app lists thousands),
 * printable file names, and the warnings that mean the build is probably wrong.
 */
export function bundleDiffEnvelopeParts<T extends FullBundleDiffLike>(
  diff: T,
): { summary: string; data: T; warnings: string[] } {
  const listed = diff.changes
    .slice(0, AGENT_LISTED_CHANGES)
    .map((change) => ({ ...change, path: printablePath(change.path) }));
  const unlisted = diff.unlistedChanges + diff.changes.length - listed.length;
  const summary =
    unlisted > 0
      ? `${describeBundleDiff(diff)} Lists the first ${listed.length} of ${listed.length + unlisted} changed files; \`otakit diff --json\` and the REST API return up to 5,000.`
      : describeBundleDiff(diff);
  return {
    summary,
    data: {
      ...diff,
      changes: listed,
      unlistedChanges: unlisted,
      warnings: diff.warnings.map((warning) => ({
        ...warning,
        paths: warning.paths.map(printablePath),
      })),
    },
    warnings: diff.warnings.filter((warning) => warning.severity === 'warning').map(warningLine),
  };
}
