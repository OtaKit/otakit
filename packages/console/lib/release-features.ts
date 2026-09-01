/**
 * Staged activation guard for durable release mutations. It defaults to false
 * so the migrated deployment keeps the existing production release path until
 * an operator explicitly enables reliability behavior.
 */
export function isReleaseReliabilityEnabled(): boolean {
  return process.env.OTAKIT_RELEASE_RELIABILITY_ENABLED === 'true';
}
