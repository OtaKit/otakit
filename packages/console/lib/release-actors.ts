/**
 * `Release.revertedBy` values the system writes, shared by server code and the
 * browser (the dashboard demo), so they live apart from the modules that use them.
 */

/** A release that auto-revert reverted. */
export const AUTO_REVERT_REVERTED_BY = 'system:auto-revert';

/** A rolling release that a newer rollout replaced. */
export const ROLLOUT_REPLACED_BY = 'system:rollout-replaced';
