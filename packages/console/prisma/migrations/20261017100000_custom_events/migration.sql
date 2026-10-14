-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "eventsPausedUntil" TIMESTAMP(3);

-- The monthly analytics cap joins the default email alerts, for default
-- destinations whose events nobody changed.
UPDATE "NotificationDestination"
SET "events" = "events" || ARRAY['analytics.paused'],
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" = 'email'
  AND "name" = 'Owners and admins'
  AND "events" = ARRAY['release.auto_reverted', 'release.auto_revert_suppressed', 'usage.warning', 'errors.regression', 'errors.spike', 'errors.paused'];
