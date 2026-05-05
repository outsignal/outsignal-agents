-- CreateTable
CREATE TABLE "DiscoveryRejectionLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "discoveryRunId" TEXT,
    "icpProfileId" TEXT,
    "campaignId" TEXT,
    "targetListId" TEXT,
    "originalTitle" TEXT,
    "targetTitles" JSONB,
    "reason" TEXT NOT NULL,
    "personName" TEXT,
    "company" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryRejectionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryRejectionLog_workspaceSlug_provider_createdAt_idx" ON "DiscoveryRejectionLog"("workspaceSlug", "provider", "createdAt");

-- CreateIndex
CREATE INDEX "DiscoveryRejectionLog_discoveryRunId_idx" ON "DiscoveryRejectionLog"("discoveryRunId");

-- CreateIndex
CREATE INDEX "DiscoveryRejectionLog_reason_idx" ON "DiscoveryRejectionLog"("reason");
