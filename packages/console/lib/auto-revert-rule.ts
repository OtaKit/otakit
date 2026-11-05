/**
 * Whether release health counts cross the auto-revert threshold. Kept free of
 * server imports so the dashboard can color its numbers by the same rule.
 */
export function shouldAutoRevert(
  counts: { applied: number; rollbacks: number },
  thresholds: { ratePercent: number; minSample: number },
): boolean {
  // `applied` only fires on a successful trial, so the failure share of
  // devices that completed a trial is rollbacks / (applied + rollbacks) —
  // a fully broken bundle has ~zero applied events.
  const attempts = counts.applied + counts.rollbacks;
  if (attempts < thresholds.minSample) {
    return false;
  }
  return counts.rollbacks * 100 >= thresholds.ratePercent * attempts;
}
