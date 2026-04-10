ALTER TABLE "Release" ADD COLUMN "previousBundleId" TEXT;
ALTER TABLE "Release" ADD COLUMN "isRollback" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Release" ADD COLUMN "rolledBackAt" TIMESTAMP(3);
ALTER TABLE "Release" ADD COLUMN "rolledBackBy" TEXT;

ALTER TABLE "Release" ADD CONSTRAINT "Release_previousBundleId_fkey"
  FOREIGN KEY ("previousBundleId") REFERENCES "Bundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
