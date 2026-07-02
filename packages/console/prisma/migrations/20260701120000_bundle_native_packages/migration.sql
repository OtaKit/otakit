-- Native package set captured at upload time for the CLI compatibility
-- guardrail. Stored on the upload session first, then carried onto the
-- bundle at finalize (mirrors how "metadata" flows).
ALTER TABLE "UploadSession" ADD COLUMN "nativePackages" JSONB;
ALTER TABLE "Bundle" ADD COLUMN "nativePackages" JSONB;
