-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('draft', 'running', 'stopped', 'shipped');

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'draft',
    "channel" TEXT,
    "channelKey" TEXT NOT NULL,
    "audienceChannels" JSONB,
    "runtimeVersions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trafficPercent" INTEGER NOT NULL DEFAULT 100,
    "variants" JSONB NOT NULL,
    "goalEvent" TEXT NOT NULL,
    "secondaryEvents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "shippedVariant" TEXT,
    "notifiedVerdict" TEXT,
    "resultsCheckedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Experiment_trafficPercent_check" CHECK ("trafficPercent" BETWEEN 1 AND 100)
);

-- CreateIndex
CREATE INDEX "Experiment_appId_status_idx" ON "Experiment"("appId", "status");

-- CreateIndex
CREATE INDEX "Experiment_status_resultsCheckedAt_idx" ON "Experiment"("status", "resultsCheckedAt");

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A/B test results join the default email alerts, for default destinations
-- whose events nobody changed.
UPDATE "NotificationDestination"
SET "events" = "events" || ARRAY['experiment.verdict_reached'],
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" = 'email'
  AND "name" = 'Owners and admins'
  AND "events" = ARRAY['release.auto_reverted', 'release.auto_revert_suppressed', 'usage.warning', 'errors.regression', 'errors.spike', 'errors.paused', 'analytics.paused'];
