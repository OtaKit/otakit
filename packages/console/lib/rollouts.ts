/** A release at this share reaches every device; below it, it is rolling out. */
export const FULL_ROLLOUT_PERCENT = 100;

export function isRolloutPercent(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 100;
}

/**
 * True while a release rolls out. A lane has at most one such release and it
 * is always the lane's current one, so a non-reverted release below 100 is the
 * active rollout of its lane.
 */
export function isRolling(
  release: { rolloutPercent: number; revertedAt?: Date | string | null } | null | undefined,
): boolean {
  return release != null && !release.revertedAt && release.rolloutPercent < FULL_ROLLOUT_PERCENT;
}
