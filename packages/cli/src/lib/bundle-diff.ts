import { describeBundleDiff, formatBundleBytes } from '@otakit/mcp-core';

import type { BundleDiff } from './api.js';

const SYMBOLS = { added: '+', changed: '~', removed: '-' } as const;

/** Human-readable comparison: the summary, up to `limit` changed files, then warnings. */
export function formatBundleDiff(diff: BundleDiff, limit = 30): string {
  const lines = [describeBundleDiff(diff)];
  if (diff.changes.length > 0) {
    lines.push('');
    for (const change of diff.changes.slice(0, limit)) {
      const size =
        change.status === 'changed'
          ? `${formatBundleBytes(change.sizeBefore ?? 0)} → ${formatBundleBytes(change.sizeAfter ?? 0)}`
          : formatBundleBytes(
              (change.status === 'added' ? change.sizeAfter : change.sizeBefore) ?? 0,
            );
      lines.push(`  ${SYMBOLS[change.status]} ${change.path}  (${size})`);
    }
    const hidden = diff.changes.length - limit + diff.unlistedChanges;
    if (hidden > 0) lines.push(`  … and ${hidden} more (use --json for all)`);
  }
  for (const warning of diff.warnings) {
    const label = warning.severity === 'warning' ? 'Warning' : 'Note';
    const more =
      warning.count > warning.paths.length
        ? ` and ${warning.count - warning.paths.length} more`
        : '';
    lines.push('', `${label}: ${warning.message}`);
    if (warning.paths.length > 0) lines.push(`  ${warning.paths.join(', ')}${more}`);
  }
  return lines.join('\n');
}
