CREATE TYPE "ReleaseMutationOperation" AS ENUM ('publish', 'revert');
CREATE TYPE "ReleaseMutationStatus" AS ENUM ('database_committed', 'published');

CREATE TABLE "ReleaseMutation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "operation" "ReleaseMutationOperation" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "ReleaseMutationStatus" NOT NULL,
    "appId" TEXT NOT NULL,
    "releaseId" TEXT,
    "channel" TEXT,
    "runtimeVersion" TEXT,
    "result" JSONB,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseMutation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReleaseMutation_organizationId_actorKey_operation_idempoten_key"
ON "ReleaseMutation"("organizationId", "actorKey", "operation", "idempotencyKey");
CREATE INDEX "ReleaseMutation_status_updatedAt_idx"
ON "ReleaseMutation"("status", "updatedAt");
CREATE INDEX "ReleaseMutation_appId_channel_runtimeVersion_createdAt_idx"
ON "ReleaseMutation"("appId", "channel", "runtimeVersion", "createdAt" DESC);
CREATE INDEX "ReleaseMutation_expiresAt_idx" ON "ReleaseMutation"("expiresAt");

ALTER TABLE "ReleaseMutation"
ADD CONSTRAINT "ReleaseMutation_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
