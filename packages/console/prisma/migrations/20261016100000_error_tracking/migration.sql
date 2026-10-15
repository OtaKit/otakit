-- CreateEnum
CREATE TYPE "ErrorIssueStatus" AS ENUM ('open', 'resolved', 'ignored');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "errorsPausedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Release" ADD COLUMN     "errorSpikeAlertedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ErrorIssue" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "ErrorIssueStatus" NOT NULL DEFAULT 'open',
    "errorName" TEXT NOT NULL,
    "normalizedMessage" TEXT NOT NULL,
    "topFrame" TEXT,
    "firstReleaseId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "resolvedReleaseIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedBy" TEXT,
    "regressions" INTEGER NOT NULL DEFAULT 0,
    "newIssueAlertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrorIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErrorIssue_appId_status_lastSeenAt_idx" ON "ErrorIssue"("appId", "status", "lastSeenAt" DESC);

-- CreateIndex
CREATE INDEX "ErrorIssue_appId_firstReleaseId_idx" ON "ErrorIssue"("appId", "firstReleaseId");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorIssue_appId_fingerprint_key" ON "ErrorIssue"("appId", "fingerprint");

-- AddForeignKey
ALTER TABLE "ErrorIssue" ADD CONSTRAINT "ErrorIssue_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Error regressions, spikes and the monthly cap join the default email alerts.
-- Only default destinations whose events nobody changed get them, so a team
-- that chose its alerts keeps exactly those.
UPDATE "NotificationDestination"
SET "events" = "events" || ARRAY['errors.regression', 'errors.spike', 'errors.paused'],
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" = 'email'
  AND "name" = 'Owners and admins'
  AND "events" = ARRAY['release.auto_reverted', 'release.auto_revert_suppressed', 'usage.warning'];
