-- Per-release emergency escalation flag: when true, devices treat this
-- release as an immediate update on their next lifecycle event.
ALTER TABLE "Release" ADD COLUMN "forceImmediate" BOOLEAN NOT NULL DEFAULT false;
