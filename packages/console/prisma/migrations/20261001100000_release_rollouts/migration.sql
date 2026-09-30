BEGIN;

-- Percentage rollouts: a release below 100 reaches only the devices whose
-- per-rollout bucket (derived on the device) falls within the percent. The
-- lane's previous release stays the stable release for everyone else.
ALTER TYPE "ReleaseMutationOperation" ADD VALUE 'rollout';

ALTER TABLE "Release"
ADD COLUMN "rolloutPercent" INTEGER NOT NULL DEFAULT 100,
ADD CONSTRAINT "Release_rolloutPercent_range" CHECK ("rolloutPercent" BETWEEN 1 AND 100);

COMMIT;
