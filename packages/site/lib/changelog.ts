import data from './changelog.json';

// Entries live in changelog.json so the page, the RSS feed and the llms.txt
// generator (scripts/generate-llms-txt.mjs, which also validates them) share
// one source. Add an entry with every release, newest first.

export type ChangelogType = 'launch' | 'feature' | 'improvement' | 'fix';
export type PackageKey = 'plugin' | 'cli' | 'push';

export type ChangelogEntry = {
  slug: string;
  /** Release date, YYYY-MM-DD (UTC, as published to npm). */
  date: string;
  type: ChangelogType;
  title: string;
  areas: string[];
  versions: Partial<Record<PackageKey, string>>;
  /** Text may use `backticks` for inline code. */
  summary: string;
  highlights?: string[];
  code?: string;
  requires?: string;
  upgrade?: string[];
  links?: { label: string; href: string }[];
};

/** The latest published version of each package, shown at the top of the page. */
export type ChangelogPackage = {
  key: PackageKey;
  name: string;
  label: string;
  install: string;
  version: string;
  date: string;
};

export const changelogEntries = data.entries as ChangelogEntry[];
export const changelogPackages = data.packages as ChangelogPackage[];

export const PACKAGE_LABELS: Record<PackageKey, string> = {
  plugin: 'Plugin',
  cli: 'CLI',
  push: 'Push SDK',
};

export const TYPE_LABELS: Record<ChangelogType, string> = {
  launch: 'Launch',
  feature: 'New',
  improvement: 'Improved',
  fix: 'Fixed',
};

export function formatChangelogDate(value: string, month: 'short' | 'long' = 'short'): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
    month,
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Plugin 3.2.0 · CLI 1.9.0" */
export function versionLabels(entry: ChangelogEntry): string[] {
  return (Object.keys(PACKAGE_LABELS) as PackageKey[])
    .filter((key) => entry.versions[key])
    .map((key) => `${PACKAGE_LABELS[key]} ${entry.versions[key]}`);
}

/** Inline `code` segments as alternating text and code parts. */
export function splitInlineCode(text: string): { code: boolean; text: string }[] {
  return text
    .split('`')
    .map((part, index) => ({ code: index % 2 === 1, text: part }))
    .filter((part) => part.text.length > 0);
}

export function stripInlineCode(text: string): string {
  return text.replaceAll('`', '');
}
