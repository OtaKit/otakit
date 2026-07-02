-- Bundle.strategy: 'zip' (single archive) or 'deltas' (per-file content-addressed objects)
ALTER TABLE "Bundle" ADD COLUMN "strategy" TEXT NOT NULL DEFAULT 'zip';

-- UploadSession delta support: strategy discriminator + validated file list
ALTER TABLE "UploadSession" ADD COLUMN "strategy" TEXT NOT NULL DEFAULT 'zip';
ALTER TABLE "UploadSession" ADD COLUMN "files" JSONB;
