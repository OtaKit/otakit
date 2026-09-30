-- Preview links: while a preview is active, a signed manifest for its bundle is
-- served on the hidden channel `__preview_<token>`. Additive only.
ALTER TABLE "App" ADD COLUMN "previewUrlScheme" TEXT;

CREATE TABLE "BundlePreview" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "BundlePreview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BundlePreview_token_key" ON "BundlePreview"("token");
CREATE INDEX "BundlePreview_appId_endedAt_expiresAt_idx" ON "BundlePreview"("appId", "endedAt", "expiresAt");
CREATE INDEX "BundlePreview_bundleId_endedAt_idx" ON "BundlePreview"("bundleId", "endedAt");
CREATE INDEX "BundlePreview_endedAt_expiresAt_idx" ON "BundlePreview"("endedAt", "expiresAt");

ALTER TABLE "BundlePreview" ADD CONSTRAINT "BundlePreview_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BundlePreview" ADD CONSTRAINT "BundlePreview_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
