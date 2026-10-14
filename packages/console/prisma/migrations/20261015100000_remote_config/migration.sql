-- CreateTable
CREATE TABLE "RemoteConfig" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "channel" TEXT,
    "channelKey" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL,
    "syncedVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemoteConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemoteConfigVersion" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "valuesJson" TEXT NOT NULL,
    "experimentsJson" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemoteConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RemoteConfig_appId_channelKey_key" ON "RemoteConfig"("appId", "channelKey");

-- CreateIndex
CREATE UNIQUE INDEX "RemoteConfigVersion_configId_version_key" ON "RemoteConfigVersion"("configId", "version");

-- AddForeignKey
ALTER TABLE "RemoteConfig" ADD CONSTRAINT "RemoteConfig_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteConfigVersion" ADD CONSTRAINT "RemoteConfigVersion_configId_fkey" FOREIGN KEY ("configId") REFERENCES "RemoteConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

