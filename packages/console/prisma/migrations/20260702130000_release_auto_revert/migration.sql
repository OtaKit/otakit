-- Per-release fleet health guard: while this release is current on its lane,
-- the auto-revert cron reverts it when, over a rolling 24h window,
-- applied+rollback attempts >= autoRevertMinSample and the rollback share
-- >= autoRevertRatePercent. Threshold columns always hold values (defaults)
-- but are only consulted when autoRevert is true.
ALTER TABLE "Release" ADD COLUMN "autoRevert" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Release" ADD COLUMN "autoRevertRatePercent" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "Release" ADD COLUMN "autoRevertMinSample" INTEGER NOT NULL DEFAULT 50;
