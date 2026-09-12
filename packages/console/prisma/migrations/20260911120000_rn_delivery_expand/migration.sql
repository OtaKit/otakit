-- Expansion only. RN app creation and runtime-aware uniqueness are not enabled
-- by this migration. Retain Bundle_appId_version_key and the legacy lane indexes
-- until every reader/writer supports RN targets.
BEGIN;

CREATE TYPE "AppFramework" AS ENUM ('capacitor', 'react-native');
CREATE TYPE "BundleTarget" AS ENUM ('cross', 'ios', 'android');

ALTER TABLE "App" ADD COLUMN "framework" "AppFramework" NOT NULL DEFAULT 'capacitor';

ALTER TABLE "Bundle"
    ADD COLUMN "platform" "BundleTarget" NOT NULL DEFAULT 'cross',
    ADD COLUMN "contentHash" TEXT,
    ADD COLUMN "contentFiles" JSONB,
    ADD COLUMN "embeddedReceipt" JSONB,
    ADD COLUMN "baselineBundleId" TEXT;

ALTER TABLE "UploadSession"
    ADD COLUMN "platform" "BundleTarget" NOT NULL DEFAULT 'cross',
    ADD COLUMN "contentHash" TEXT,
    ADD COLUMN "embeddedReceipt" JSONB,
    ADD COLUMN "baselineBundleId" TEXT;

ALTER TABLE "Release"
    ADD COLUMN "platform" "BundleTarget" NOT NULL DEFAULT 'cross',
    ADD COLUMN "runtimeVersion" TEXT;

ALTER TABLE "ReleaseMutation"
    ADD COLUMN "platform" "BundleTarget" NOT NULL DEFAULT 'cross';

-- Preserve null runtimes and all existing release IDs/settings/history. Old
-- writers can still insert releases without the new snapshot columns; readers
-- must continue deriving their lane from Bundle until the final rollout backfill.
UPDATE "Release" AS release
SET "platform" = bundle."platform", "runtimeVersion" = bundle."runtimeVersion"
FROM "Bundle" AS bundle
WHERE release."bundleId" = bundle."id";

ALTER TABLE "Bundle" ADD CONSTRAINT "Bundle_baselineBundleId_fkey"
    FOREIGN KEY ("baselineBundleId") REFERENCES "Bundle"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_baselineBundleId_fkey"
    FOREIGN KEY ("baselineBundleId") REFERENCES "Bundle"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Bundle_baselineBundleId_idx" ON "Bundle"("baselineBundleId");
CREATE INDEX "UploadSession_baselineBundleId_idx" ON "UploadSession"("baselineBundleId");
CREATE INDEX "Release_current_lane_idx"
    ON "Release"("appId", "platform", "channel", "runtimeVersion", "revertedAt", "promotedAt" DESC, "id" DESC);
CREATE INDEX "ReleaseMutation_target_lane_idx"
    ON "ReleaseMutation"("appId", "platform", "channel", "runtimeVersion", "createdAt" DESC);

COMMIT;
