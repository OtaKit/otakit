import type { BundleFile, BundleFileList } from './bundle-files';

/**
 * What changed between two bundles' file lists, how much a device downloads,
 * and content that probably should not ship. Pure; safe to import anywhere.
 */

export type FileChangeStatus = 'added' | 'removed' | 'changed';

export type FileChange = {
  path: string;
  status: FileChangeStatus;
  sizeBefore: number | null;
  sizeAfter: number | null;
};

export type BundleWarningCode =
  | 'env_file'
  | 'git_directory'
  | 'node_modules'
  | 'source_map'
  | 'dotfile'
  | 'native_installer'
  | 'large_new_file'
  | 'size_increase';

export type BundleWarning = {
  code: BundleWarningCode;
  /** `warning`: almost certainly a mistake. `note`: worth a look. */
  severity: 'warning' | 'note';
  message: string;
  /** Up to MAX_WARNING_PATHS example paths. */
  paths: string[];
  count: number;
};

export type FileListDiff = {
  /** False when the lists use different hashes (zip vs deltas): changes are by size only. */
  comparable: boolean;
  changes: FileChange[];
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  /** Unpacked bytes. */
  totalBefore: number | null;
  totalAfter: number;
};

export const MAX_WARNING_PATHS = 10;
const LARGE_NEW_FILE_BYTES = 2 * 1024 * 1024;
// Growth worth a note: more than 20%, and at least 1 MB.
const SIZE_INCREASE_RATIO = 1.2;
const SIZE_INCREASE_BYTES = 1024 * 1024;
const INSTALLER = /\.(exe|msi|dmg|pkg|apk|ipa|appx|msix|deb|rpm)$/i;
const STATUS_ORDER: Record<FileChangeStatus, number> = { added: 0, changed: 1, removed: 2 };

function total(files: BundleFile[]): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}

export function diffFileLists(base: BundleFileList | null, target: BundleFileList): FileListDiff {
  const comparable = base === null || base.hashType === target.hashType;
  const before = new Map((base?.files ?? []).map((file) => [file.path, file]));
  const changes: FileChange[] = [];
  let unchanged = 0;
  for (const file of target.files) {
    const previous = before.get(file.path);
    before.delete(file.path);
    if (!previous) {
      changes.push({ path: file.path, status: 'added', sizeBefore: null, sizeAfter: file.size });
    } else if (previous.size !== file.size || (comparable && previous.hash !== file.hash)) {
      changes.push({
        path: file.path,
        status: 'changed',
        sizeBefore: previous.size,
        sizeAfter: file.size,
      });
    } else {
      unchanged += 1;
    }
  }
  for (const file of before.values()) {
    changes.push({ path: file.path, status: 'removed', sizeBefore: file.size, sizeAfter: null });
  }
  changes.sort(
    (left, right) =>
      STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || left.path.localeCompare(right.path),
  );
  const count = (status: FileChangeStatus) =>
    changes.filter((change) => change.status === status).length;
  return {
    comparable,
    changes,
    added: count('added'),
    removed: count('removed'),
    changed: count('changed'),
    unchanged,
    totalBefore: base ? total(base.files) : null,
    totalAfter: total(target.files),
  };
}

/**
 * Bytes a device on `base` downloads for `target`. Delta updates fetch only
 * files whose content (sha256) the device does not have yet; a zip update is
 * the whole archive. Null when it depends on what the device cached before.
 */
export function downloadBytes(
  base: { strategy: string; list: BundleFileList | null } | null,
  target: { strategy: string; size: number; list: BundleFileList },
): number | null {
  if (target.strategy !== 'deltas') return target.size;
  if (base?.strategy !== 'deltas' || !base.list || base.list.hashType !== 'sha256') return null;
  const cached = new Set(base.list.files.map((file) => file.hash));
  const missing = new Map<string, number>();
  for (const file of target.list.files) {
    if (!cached.has(file.hash)) missing.set(file.hash, file.size);
  }
  let bytes = 0;
  for (const size of missing.values()) bytes += size;
  return bytes;
}

type ContentRule = {
  code: BundleWarningCode;
  severity: BundleWarning['severity'];
  matches: (segments: string[]) => boolean;
  message: string;
};

// Each file counts for the first rule it matches.
const CONTENT_RULES: ContentRule[] = [
  {
    code: 'env_file',
    severity: 'warning',
    matches: (segments) => /^\.env(\..+)?$/i.test(segments[segments.length - 1]),
    message:
      'Environment files (.env) often hold secrets, and anyone with the app can read every bundle file.',
  },
  {
    code: 'git_directory',
    severity: 'warning',
    matches: (segments) => segments.includes('.git'),
    message: 'A .git directory exposes your repository history.',
  },
  {
    code: 'node_modules',
    severity: 'warning',
    matches: (segments) => segments.includes('node_modules'),
    message: 'node_modules belongs to the build, not the app; it is usually large and unused.',
  },
  {
    code: 'source_map',
    severity: 'note',
    matches: (segments) => segments[segments.length - 1].toLowerCase().endsWith('.map'),
    message:
      'Source maps reveal your original source code. Remove them unless you ship them on purpose.',
  },
  {
    code: 'dotfile',
    severity: 'note',
    matches: (segments) => segments.some((segment) => segment.startsWith('.')),
    message: 'Hidden files such as .DS_Store are usually left over from the build machine.',
  },
  {
    code: 'native_installer',
    severity: 'note',
    matches: (segments) =>
      INSTALLER.test(segments[segments.length - 1]) ||
      segments.some((segment) => segment.toLowerCase().endsWith('.app')),
    message: 'Native installers and app packages do not run in the web bundle.',
  },
];

function warning(
  rule: Pick<ContentRule, 'code' | 'severity' | 'message'>,
  paths: string[],
): BundleWarning {
  const sorted = [...paths].sort((left, right) => left.localeCompare(right));
  return {
    code: rule.code,
    severity: rule.severity,
    message: rule.message,
    paths: sorted.slice(0, MAX_WARNING_PATHS),
    count: sorted.length,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Warnings about the target bundle's content and how it grew. Warnings come first. */
export function bundleWarnings(target: BundleFileList, diff: FileListDiff | null): BundleWarning[] {
  const matched = new Map<BundleWarningCode, string[]>();
  for (const file of target.files) {
    const segments = file.path.split('/');
    const rule = CONTENT_RULES.find((candidate) => candidate.matches(segments));
    if (rule) matched.set(rule.code, [...(matched.get(rule.code) ?? []), file.path]);
  }
  const warnings = CONTENT_RULES.filter((rule) => matched.has(rule.code)).map((rule) =>
    warning(rule, matched.get(rule.code) ?? []),
  );

  if (diff) {
    const large = diff.changes.filter(
      (change) => change.status === 'added' && (change.sizeAfter ?? 0) >= LARGE_NEW_FILE_BYTES,
    );
    if (large.length > 0) {
      warnings.push(
        warning(
          {
            code: 'large_new_file',
            severity: 'note',
            message: 'New files of 2 MB or more make every update download larger.',
          },
          large.map((change) => change.path),
        ),
      );
    }
    if (
      diff.totalBefore &&
      diff.totalAfter > diff.totalBefore * SIZE_INCREASE_RATIO &&
      diff.totalAfter - diff.totalBefore >= SIZE_INCREASE_BYTES
    ) {
      warnings.push({
        code: 'size_increase',
        severity: 'note',
        message: `The bundle grew by ${Math.round((diff.totalAfter / diff.totalBefore - 1) * 100)}% (${formatBytes(diff.totalBefore)} → ${formatBytes(diff.totalAfter)}).`,
        paths: [],
        count: 0,
      });
    }
  }
  return warnings.sort(
    (left, right) => Number(left.severity === 'note') - Number(right.severity === 'note'),
  );
}
