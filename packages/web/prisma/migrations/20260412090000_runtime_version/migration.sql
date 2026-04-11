-- AlterTable
ALTER TABLE "Bundle"
DROP COLUMN "minNativeBuild",
ADD COLUMN "runtimeVersion" TEXT;

-- AlterTable
ALTER TABLE "UploadSession"
DROP COLUMN "minNativeBuild",
ADD COLUMN "runtimeVersion" TEXT;
