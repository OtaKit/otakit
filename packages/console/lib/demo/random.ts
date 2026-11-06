/**
 * Seeded randomness for the dashboard demo, so the simulated fleet tells the
 * same story on every visit.
 */

export type Random = () => number;

/** mulberry32: small, fast and good enough for a simulation. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A Poisson draw: exact (Knuth) for small means, normal approximation above. */
export function poisson(random: Random, mean: number): number {
  if (!(mean > 0)) return 0;
  if (mean > 40) {
    // Box-Muller normal with the same mean and variance.
    const u = Math.max(random(), 1e-12);
    const v = random();
    const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal));
  }
  const limit = Math.exp(-mean);
  let count = 0;
  let product = random();
  while (product > limit) {
    count += 1;
    product *= random();
  }
  return count;
}

/** How many of `count` trials succeed with probability `p`. */
export function binomial(random: Random, count: number, p: number): number {
  if (count <= 0 || p <= 0) return 0;
  if (p >= 1) return count;
  if (count < 30) {
    let hits = 0;
    for (let i = 0; i < count; i += 1) if (random() < p) hits += 1;
    return hits;
  }
  return Math.min(count, poisson(random, count * p));
}

/** A stable hex string, for ids and file hashes. */
export function hexId(random: Random, length: number): string {
  let out = '';
  while (out.length < length) out += Math.floor(random() * 16).toString(16);
  return out;
}

/** A stable hash of a string, for deterministic per-item seeds. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
