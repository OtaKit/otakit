BEGIN;

-- Starter is a monthly-only $10 subscription with 100k downloads. The value
-- is added without changing any existing organization's current plan.
ALTER TYPE "PlanKey" ADD VALUE 'starter' AFTER 'free';

-- Keep the Free plan name while persisting each organization's granted Free
-- allowance. All organizations that are Free when this migration runs are
-- grandfathered at 100k; organizations created afterwards receive 5k.
ALTER TABLE "Organization"
ADD COLUMN "freeDownloadsLimit" INTEGER NOT NULL DEFAULT 5000,
ADD CONSTRAINT "Organization_freeDownloadsLimit_positive" CHECK ("freeDownloadsLimit" > 0);

UPDATE "Organization"
SET "freeDownloadsLimit" = 100000
WHERE "planKey" = 'free';

COMMIT;
