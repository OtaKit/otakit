ALTER TABLE "Release"
ADD COLUMN "autoRevertAlertPayload" JSONB,
ADD COLUMN "autoRevertAlertClaimedAt" TIMESTAMP(3),
ADD COLUMN "autoRevertAlertedAt" TIMESTAMP(3);

CREATE INDEX "Release_autoRevertAlertedAt_autoRevertAlertClaimedAt_idx"
ON "Release"("autoRevertAlertedAt", "autoRevertAlertClaimedAt");
