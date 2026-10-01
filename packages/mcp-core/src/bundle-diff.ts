/** The parts of a bundle diff (REST response or service result) the summary reads. */
type BundleDiffLike = {
  target: { version: string };
  base: { version: string } | null;
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

/** "980 B", "38.0 KB", "4.1 MB". */
export function formatBundleBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const UNAVAILABLE: Record<'encrypted' | 'unreadable', string> = {
  encrypted: 'it is encrypted',
  unreadable: 'its files could not be read',
};

/**
 * One line for a bundle comparison, e.g.
 * "1.4.2 vs 1.4.1: +3 ~12 -1 · 4.1 MB → 4.3 MB · devices download ≈ 38.0 KB".
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
  const parts = [
    `+${summary.added} ~${summary.changed} -${summary.removed}`,
    `${formatBundleBytes(summary.totalBefore ?? 0)} → ${formatBundleBytes(summary.totalAfter)}`,
    summary.downloadBytes === null
      ? 'devices download up to the full bundle'
      : `devices download ≈ ${formatBundleBytes(summary.downloadBytes)}`,
  ];
  const caveat = diff.comparable ? '' : ' (by size: one bundle is zip, the other deltas)';
  return `${diff.target.version} vs ${options.baseLabel ?? diff.base.version}: ${parts.join(' · ')}${caveat}`;
}
