-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "creditsConsumed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "creditsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "polarReportedCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CreditGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "downloads" INTEGER NOT NULL,
    "revokedDownloads" INTEGER NOT NULL DEFAULT 0,
    "polarOrderId" TEXT NOT NULL,
    "polarProductId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditGrant_polarOrderId_key" ON "CreditGrant"("polarOrderId");

-- CreateIndex
CREATE INDEX "CreditGrant_organizationId_createdAt_idx" ON "CreditGrant"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "CreditGrant" ADD CONSTRAINT "CreditGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

