/** `Release.revertedBy` of releases the auto-revert sweep reverted. */
export const AUTO_REVERT_REVERTED_BY = 'system:auto-revert';

/**
 * The health numbers behind an auto-revert decision: recorded in the audit log
 * and sent with the release.auto_reverted and release.auto_revert_suppressed
 * notifications.
 */
export type AutoRevertAlertPayload = {
  appId: string;
  channel: string | null;
  runtimeVersion: string | null;
  bundleVersion: string;
  rollbacks: number;
  attempts: number;
  measuredRatePercent: number;
  ratePercent: number;
  minSample: number;
  windowHours: number;
};
