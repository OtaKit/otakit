CREATE TABLE "OrganizationOnboarding" (
    "organizationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "step" TEXT NOT NULL DEFAULT 'app',
    "connectedAppId" TEXT,
    "completedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationOnboarding_pkey" PRIMARY KEY ("organizationId"),
    CONSTRAINT "OrganizationOnboarding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrganizationOnboarding_connectedAppId_fkey" FOREIGN KEY ("connectedAppId") REFERENCES "App"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OrganizationOnboarding_connectedAppId_key" ON "OrganizationOnboarding"("connectedAppId");

-- Insights uses a dedicated role that may not exist on self-hosted instances.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'otakit_insights_readonly') THEN
        GRANT SELECT ON TABLE "OrganizationOnboarding" TO otakit_insights_readonly;
    END IF;
END $$;
