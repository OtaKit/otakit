export interface DeltaFileEntry {
  path: string;
  sha256: string;
  size: number;
}
import folding from './unicode/case-folding-15.0.0.json';

const caseFolding: Record<string, string> = folding;
const RESERVED_ROOTS = new Set(['bundle.json', 'otakit_files.json', 'otakit-embedded.json']);

export function rnPathComparisonKey(value: string): string {
  return Array.from(value.normalize('NFD'), (char) => caseFolding[char] ?? char)
    .join('')
    .normalize('NFD');
}

type InventoryResult =
  | { ok: true; files: DeltaFileEntry[]; totalSize: number }
  | { ok: false; error: string };

/** Validate declarations for either transport. This does not inspect archive bytes. */
export function parseRNInventory(raw: unknown, maxSize: number): InventoryResult {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 5000)
    return { ok: false, error: 'RN inventory must contain 2-5000 files' };

  const nodes = new Map<string, { spelling: string; directory: boolean }>();
  const sizes = new Map<string, number>();
  const files: DeltaFileEntry[] = [];
  let totalSize = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return { ok: false, error: 'Each RN file entry must be an object' };
    const { path, sha256, size } = entry;
    if (
      typeof path !== 'string' ||
      !path ||
      Buffer.byteLength(path, 'utf8') > 512 ||
      /[\\\u0000-\u001f\u007f]/u.test(path) ||
      // Reject lone surrogates instead of hashing UTF-8 replacement characters.
      Buffer.from(path, 'utf8').toString('utf8') !== path
    )
      return { ok: false, error: 'Invalid RN file path or UTF-8 byte length' };

    const segments = path.split('/');
    let spelling = '';
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (
        !segment ||
        segment === '.' ||
        segment === '..' ||
        Buffer.byteLength(segment, 'utf8') > 255
      )
        return { ok: false, error: `Invalid RN path component: ${path}` };
      spelling += `${i === 0 ? '' : '/'}${segment}`;
      const key = rnPathComparisonKey(spelling);
      if (i === 0 && RESERVED_ROOTS.has(key))
        return { ok: false, error: `Reserved RN metadata path: ${path}` };
      const directory = i < segments.length - 1;
      const previous = nodes.get(key);
      if (
        previous &&
        (previous.spelling !== spelling || previous.directory !== directory || !directory)
      )
        return { ok: false, error: `Conflicting RN file or directory path: ${path}` };
      nodes.set(key, { spelling, directory });
    }

    if (
      typeof sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(sha256) ||
      !Number.isSafeInteger(size) ||
      size < 0
    )
      return { ok: false, error: `Invalid RN file hash or size: ${path}` };
    const normalizedHash = sha256.toLowerCase();
    if (sizes.has(normalizedHash) && sizes.get(normalizedHash) !== size)
      return { ok: false, error: `Conflicting sizes for RN content hash: ${path}` };
    sizes.set(normalizedHash, size);
    totalSize += size;
    if (!Number.isSafeInteger(totalSize) || totalSize > maxSize)
      return { ok: false, error: `RN payload exceeds the ${maxSize} byte limit` };
    files.push({ path, sha256: normalizedHash, size });
  }
  for (const required of ['index.bundle', 'otakit-bundle.json']) {
    if (!files.some((file) => file.path === required && file.size > 0))
      return { ok: false, error: `RN inventory must include nonempty ${required} at the root` };
  }
  return { ok: true, files, totalSize };
}
