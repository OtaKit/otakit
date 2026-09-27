-- CreateEnum
CREATE TYPE "PushProvider" AS ENUM ('apns', 'fcm');

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('ios', 'android');

-- CreateEnum
CREATE TYPE "PushEnvironment" AS ENUM ('production', 'sandbox');

-- CreateEnum
CREATE TYPE "PushCampaignStatus" AS ENUM ('queued', 'sending', 'completed', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "PushBatchStatus" AS ENUM ('pending', 'sending', 'done');

-- CreateTable
CREATE TABLE "PushCredential" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "provider" "PushProvider" NOT NULL,
    "sealedSecret" TEXT NOT NULL,
    "apnsKeyId" TEXT,
    "apnsTeamId" TEXT,
    "apnsBundleId" TEXT,
    "fcmProjectId" TEXT,
    "fcmClientEmail" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastTestResult" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "provider" "PushProvider" NOT NULL,
    "token" TEXT NOT NULL,
    "environment" "PushEnvironment" NOT NULL DEFAULT 'production',
    "externalUserId" TEXT,
    "topics" TEXT[],
    "channel" TEXT,
    "runtimeVersion" TEXT,
    "bundleVersion" TEXT,
    "appVersion" TEXT,
    "locale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushCampaign" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "audience" JSONB NOT NULL,
    "status" "PushCampaignStatus" NOT NULL DEFAULT 'queued',
    "targeted" INTEGER NOT NULL DEFAULT 0,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "invalidRemoved" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" JSONB,
    "failureReason" TEXT,
    "idempotencyKey" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PushCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSendBatch" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "deviceIds" TEXT[],
    "status" "PushBatchStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "PushSendBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushUsage" (
    "organizationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "sends" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PushUsage_pkey" PRIMARY KEY ("organizationId","periodStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushCredential_appId_provider_key" ON "PushCredential"("appId", "provider");

-- CreateIndex
CREATE INDEX "PushDevice_appId_platform_idx" ON "PushDevice"("appId", "platform");

-- CreateIndex
CREATE INDEX "PushDevice_appId_externalUserId_idx" ON "PushDevice"("appId", "externalUserId");

-- CreateIndex
CREATE INDEX "PushDevice_appId_channel_idx" ON "PushDevice"("appId", "channel");

-- CreateIndex
CREATE INDEX "PushDevice_appId_lastSeenAt_idx" ON "PushDevice"("appId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_appId_token_key" ON "PushDevice"("appId", "token");

-- CreateIndex
CREATE INDEX "PushCampaign_appId_createdAt_idx" ON "PushCampaign"("appId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PushCampaign_appId_idempotencyKey_key" ON "PushCampaign"("appId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PushSendBatch_status_nextAttemptAt_idx" ON "PushSendBatch"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PushSendBatch_campaignId_idx" ON "PushSendBatch"("campaignId");

-- AddForeignKey
ALTER TABLE "PushCredential" ADD CONSTRAINT "PushCredential_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushCampaign" ADD CONSTRAINT "PushCampaign_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSendBatch" ADD CONSTRAINT "PushSendBatch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PushCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushUsage" ADD CONSTRAINT "PushUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Insights uses a dedicated role that may not exist on self-hosted instances.
-- Push credentials hold secrets (sealed), so they stay out of the read-only grant.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'otakit_insights_readonly') THEN
        GRANT SELECT ON TABLE "PushDevice", "PushCampaign", "PushSendBatch", "PushUsage" TO otakit_insights_readonly;
    END IF;
END $$;
