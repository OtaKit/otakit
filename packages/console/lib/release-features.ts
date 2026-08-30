/**
 * Staged rollout guard for the additive ReleaseMutation table. It defaults to
 * false so deploying application code before applying the migration preserves
 * the existing production release path.
 */
export function isReleaseReliabilityEnabled(): boolean {
  return process.env.OTAKIT_RELEASE_RELIABILITY_ENABLED === 'true';
}
