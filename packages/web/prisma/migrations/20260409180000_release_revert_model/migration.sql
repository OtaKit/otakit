ALTER TABLE "Release" DROP COLUMN "isRollback";
ALTER TABLE "Release" DROP COLUMN "rolledBackAt";
ALTER TABLE "Release" DROP COLUMN "rolledBackBy";
ALTER TABLE "Release" ADD COLUMN "revertedAt" TIMESTAMP(3);
ALTER TABLE "Release" ADD COLUMN "revertedBy" TEXT;
