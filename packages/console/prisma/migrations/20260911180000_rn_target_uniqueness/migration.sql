-- Apply only after all readers/writers understand RN targeting and old revisions
-- have drained. Keep RN creation disabled until native acceptance is complete.
-- Production application is a separate operator action; local fixtures may deploy it.
BEGIN;

UPDATE "Release" AS r
SET "platform" = b."platform", "runtimeVersion" = b."runtimeVersion"
FROM "Bundle" AS b
WHERE r."bundleId" = b.id
  AND (r."platform" IS DISTINCT FROM b."platform"
    OR r."runtimeVersion" IS DISTINCT FROM b."runtimeVersion");

ALTER TABLE "Bundle" ADD CONSTRAINT "Bundle_rn_runtime_required"
  CHECK ("platform" = 'cross' OR ("runtimeVersion" IS NOT NULL
    AND "runtimeVersion" ~ '^[A-Za-z0-9_-]{43}$'));
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_rn_runtime_required"
  CHECK ("platform" = 'cross' OR ("runtimeVersion" IS NOT NULL
    AND "runtimeVersion" ~ '^[A-Za-z0-9_-]{43}$'));

CREATE UNIQUE INDEX "Bundle_cross_version_key"
  ON "Bundle" ("appId", "version") WHERE "platform" = 'cross';
CREATE UNIQUE INDEX "Bundle_target_version_key"
  ON "Bundle" ("appId", "platform", "runtimeVersion", "version");

-- Last: Capacitor retains its original version identity through the partial index.
DROP INDEX "Bundle_appId_version_key";
COMMIT;
