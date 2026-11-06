import type { BundleFileList } from '@/lib/bundle-files';

import { hashString, hexId, seededRandom } from './random';

/**
 * The files of a demo bundle: a typical Vite build of a Capacitor app, so the
 * Changes dialog shows real diffs, delta download sizes and warnings computed
 * by the same code as for uploaded bundles.
 */

const VITE_HASH_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

function viteHash(seed: string): string {
  const random = seededRandom(hashString(seed));
  let out = '';
  for (let i = 0; i < 8; i += 1) out += VITE_HASH_ALPHABET[Math.floor(random() * 64)];
  return out;
}

function sha(seed: string): string {
  return hexId(seededRandom(hashString(seed)), 64);
}

function size(seed: string, base: number, spread: number): number {
  const random = seededRandom(hashString(seed));
  return Math.round(base + (random() - 0.5) * 2 * spread);
}

/** "2.3.1" → [2, 3, 1]. */
function parts(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

const IMAGES = [
  'hero-run',
  'hero-yoga',
  'plan-strength',
  'plan-mobility',
  'badge-first-week',
  'avatar-placeholder',
  'empty-state',
  'onboarding-1',
  'onboarding-2',
  'onboarding-3',
];
/** Images added by a later version. */
const ADDED_IMAGES: Record<string, string[]> = {
  '2.2.0': ['home-card-goals', 'home-card-streak'],
  '2.4.0': ['streak-flame', 'streak-week', 'progress-empty'],
};
const LOCALES = ['en', 'de', 'es', 'fr', 'ja', 'pt-BR'];

export function demoBundleFiles(appSlug: string, version: string): BundleFileList {
  const [major, minor] = parts(version);
  const minorLine = `${major}.${minor}`;
  const files: BundleFileList['files'] = [];
  const add = (path: string, bytes: number, hashSeed: string) =>
    files.push({ path, size: bytes, hash: sha(`${appSlug}:${path}:${hashSeed}`) });

  // App code changes with every release; its file name carries the content hash.
  const appHash = viteHash(`${appSlug}:index:${version}`);
  add('index.html', size(`html:${version}`, 1_480, 60), version);
  add(`assets/index-${appHash}.js`, size(`app:${version}`, 372_000, 22_000), version);
  // Dependencies only move with minor versions.
  const vendorHash = viteHash(`${appSlug}:vendor:${minorLine}`);
  add(`assets/vendor-${vendorHash}.js`, size(`vendor:${minorLine}`, 806_000, 18_000), minorLine);
  const cssHash = viteHash(`${appSlug}:css:${minorLine}`);
  add(`assets/index-${cssHash}.css`, size(`css:${minorLine}`, 61_000, 6_000), minorLine);
  if (version === '2.4.1') {
    // A source map that should not ship: the Changes dialog flags it.
    add(`assets/index-${appHash}.js.map`, 1_212_884, version);
  }

  for (const font of ['inter-400', 'inter-600', 'inter-700']) {
    add(`assets/fonts/${font}.woff2`, size(`font:${font}`, 46_000, 4_000), 'v1');
  }
  const images = [...IMAGES];
  for (const [since, added] of Object.entries(ADDED_IMAGES)) {
    const [sinceMajor, sinceMinor] = parts(since);
    if (major > sinceMajor || (major === sinceMajor && minor >= sinceMinor)) images.push(...added);
  }
  for (const image of images) {
    // An image is re-exported now and then; most releases keep it.
    const revision = hashString(`${image}:${minorLine}`) % 4 === 0 ? minorLine : 'v1';
    add(`assets/img/${image}.webp`, size(`img:${image}:${revision}`, 58_000, 46_000), revision);
  }
  for (const locale of LOCALES) {
    add(`locales/${locale}.json`, size(`locale:${locale}:${minorLine}`, 19_000, 3_000), minorLine);
  }
  add('manifest.webmanifest', 612, 'v1');
  add('favicon.svg', 1_204, 'v1');

  return { hashType: 'sha256', files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}
