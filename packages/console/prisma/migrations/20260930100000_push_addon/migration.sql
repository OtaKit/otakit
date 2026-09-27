-- Push notifications became an add-on in its own package (@otakit/push-server) with
-- its own tables in the "push" schema. The workspace switch stays in the core.
ALTER TABLE "Organization" ADD COLUMN "pushEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Workspaces that already used push keep it on.
UPDATE "Organization" o SET "pushEnabled" = true
WHERE EXISTS (
    SELECT 1 FROM "App" a JOIN "PushCredential" c ON c."appId" = a.id
    WHERE a."organizationId" = o.id
);

-- Move existing push data into the add-on's own schema. `pnpm db:migrate` applies the
-- push-server migrations first, so the target tables exist. If they do not and there
-- is push data, stop instead of dropping it. Campaign batches are not moved.
DO $$
BEGIN
    IF to_regclass('push."PushDevice"') IS NULL THEN
        IF EXISTS (SELECT 1 FROM public."PushCredential")
            OR EXISTS (SELECT 1 FROM public."PushDevice")
            OR EXISTS (SELECT 1 FROM public."PushCampaign") THEN
            RAISE EXCEPTION 'Push data exists but the "push" schema is missing. Run the @otakit/push-server migrations first (pnpm db:migrate does both).';
        END IF;
    ELSE
        INSERT INTO push."PushCredential" (id, "appId", provider, "sealedSecret", "apnsKeyId",
            "apnsTeamId", "apnsBundleId", "fcmProjectId", "fcmClientEmail", "lastTestAt",
            "lastTestResult", "createdBy", "createdAt", "updatedAt")
        SELECT id, "appId", provider::text::push."PushProvider", "sealedSecret", "apnsKeyId",
            "apnsTeamId", "apnsBundleId", "fcmProjectId", "fcmClientEmail", "lastTestAt",
            "lastTestResult", "createdBy", "createdAt", "updatedAt"
        FROM public."PushCredential"
        ON CONFLICT DO NOTHING;

        INSERT INTO push."PushDevice" (id, "organizationId", "appId", platform, provider, token,
            environment, "externalUserId", topics, channel, "runtimeVersion", "bundleVersion",
            "appVersion", locale, "createdAt", "lastSeenAt")
        SELECT d.id, a."organizationId", d."appId", d.platform::text::push."PushPlatform",
            d.provider::text::push."PushProvider", d.token,
            d.environment::text::push."PushEnvironment", d."externalUserId", d.topics, d.channel,
            d."runtimeVersion", d."bundleVersion", d."appVersion", d.locale, d."createdAt",
            d."lastSeenAt"
        FROM public."PushDevice" d JOIN public."App" a ON a.id = d."appId"
        ON CONFLICT DO NOTHING;

        INSERT INTO push."PushCampaign" (id, "organizationId", "appId", payload, audience,
            status, targeted, accepted, failed, "invalidRemoved", "errorSummary",
            "failureReason", "idempotencyKey", "createdBy", "createdAt", "completedAt")
        SELECT id, "organizationId", "appId", payload, audience,
            CASE WHEN status::text IN ('queued', 'sending') THEN 'canceled'
                 ELSE status::text END::push."PushCampaignStatus",
            targeted, accepted, failed, "invalidRemoved", "errorSummary", "failureReason",
            "idempotencyKey", "createdBy", "createdAt", "completedAt"
        FROM public."PushCampaign"
        ON CONFLICT DO NOTHING;

        INSERT INTO push."PushUsage" ("organizationId", "periodStart", sends)
        SELECT "organizationId", "periodStart", sends FROM public."PushUsage"
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

DROP TABLE "PushSendBatch";
DROP TABLE "PushCampaign";
DROP TABLE "PushDevice";
DROP TABLE "PushCredential";
DROP TABLE "PushUsage";

DROP TYPE "PushBatchStatus";
DROP TYPE "PushCampaignStatus";
DROP TYPE "PushEnvironment";
DROP TYPE "PushPlatform";
DROP TYPE "PushProvider";
