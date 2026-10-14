-- CreateEnum
CREATE TYPE "NotificationDestinationType" AS ENUM ('email', 'webhook', 'slack', 'discord');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('pending', 'sending', 'delivered', 'failed');

-- CreateTable
CREATE TABLE "NotificationDestination" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "appId" TEXT,
    "type" "NotificationDestinationType" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "emailRecipients" JSONB,
    "secretCiphertext" TEXT,
    "previousSecretCiphertext" TEXT,
    "previousSecretExpiresAt" TIMESTAMP(3),
    "events" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "disabledReason" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "lastDurationMs" INTEGER,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationDestination_organizationId_idx" ON "NotificationDestination"("organizationId");

-- CreateIndex
CREATE INDEX "NotificationDestination_appId_idx" ON "NotificationDestination"("appId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_destinationId_createdAt_idx" ON "NotificationDelivery"("destinationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NotificationDelivery_createdAt_idx" ON "NotificationDelivery"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_destinationId_eventKey_key" ON "NotificationDelivery"("destinationId", "eventKey");

-- AddForeignKey
ALTER TABLE "NotificationDestination" ADD CONSTRAINT "NotificationDestination_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDestination" ADD CONSTRAINT "NotificationDestination_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "NotificationDestination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every workspace starts with the alerts it already received by email: owners
-- and admins hear about auto-reverts and usage warnings.
INSERT INTO "NotificationDestination" ("id", "organizationId", "type", "name", "emailRecipients", "events", "updatedAt")
SELECT
    gen_random_uuid()::text,
    "id",
    'email',
    'Owners and admins',
    '{"mode": "owners_admins"}'::jsonb,
    ARRAY['release.auto_reverted', 'release.auto_revert_suppressed', 'usage.warning'],
    CURRENT_TIMESTAMP
FROM "Organization";
