-- CreateTable
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "icpProfileId" TEXT,
    "icpProfileVersionId" TEXT,
    "icpProfileSnapshot" JSONB,
    "triggeredBy" TEXT,
    "triggeredVia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "discoveredCount" INTEGER NOT NULL DEFAULT 0,
    "promotedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "DiscoveredPerson" ADD COLUMN "icpProfileVersionId" TEXT;

-- AlterTable
ALTER TABLE "LeadWorkspace" ADD COLUMN "icpProfileVersionId" TEXT;

-- CreateIndex
CREATE INDEX "DiscoveryRun_workspaceId_createdAt_idx" ON "DiscoveryRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscoveryRun_icpProfileId_idx" ON "DiscoveryRun"("icpProfileId");

-- CreateIndex
CREATE INDEX "DiscoveryRun_icpProfileVersionId_idx" ON "DiscoveryRun"("icpProfileVersionId");

-- CreateIndex
CREATE INDEX "DiscoveredPerson_icpProfileVersionId_idx" ON "DiscoveredPerson"("icpProfileVersionId");

-- CreateIndex
CREATE INDEX "LeadWorkspace_icpProfileVersionId_idx" ON "LeadWorkspace"("icpProfileVersionId");

-- Backfill historical run anchors from existing soft-grouped rows.
-- Profile context is intentionally null: historical scores predate the
-- resolver and cannot be reproduced against a specific profile version.
WITH grouped AS (
    SELECT
        dp."discoveryRunId" AS id,
        w."id" AS "workspaceId",
        MIN(dp."createdAt") AS "createdAt",
        MAX(dp."updatedAt") AS "completedAt",
        COUNT(*)::integer AS "discoveredCount",
        COUNT(*) FILTER (WHERE dp."status" = 'promoted')::integer AS "promotedCount",
        COUNT(*) FILTER (
            WHERE dp."status" IN ('rejected', 'scored_rejected', 'discarded', 'excluded')
        )::integer AS "rejectedCount",
        ROW_NUMBER() OVER (
            PARTITION BY dp."discoveryRunId"
            ORDER BY COUNT(*) DESC, MIN(dp."createdAt") ASC
        ) AS rn
    FROM "DiscoveredPerson" dp
    JOIN "Workspace" w ON w."slug" = dp."workspaceSlug"
    WHERE dp."discoveryRunId" IS NOT NULL
    GROUP BY dp."discoveryRunId", w."id"
)
INSERT INTO "DiscoveryRun" (
    "id",
    "workspaceId",
    "triggeredBy",
    "triggeredVia",
    "createdAt",
    "completedAt",
    "discoveredCount",
    "promotedCount",
    "rejectedCount"
)
SELECT
    id,
    "workspaceId",
    'historical',
    'historical',
    "createdAt",
    "completedAt",
    "discoveredCount",
    "promotedCount",
    "rejectedCount"
FROM grouped
WHERE rn = 1
ON CONFLICT ("id") DO NOTHING;

-- Rows whose workspace slug no longer resolves are intentionally left without
-- a run anchor so the foreign key can be added safely.
UPDATE "DiscoveredPerson" dp
SET "discoveryRunId" = NULL
WHERE dp."discoveryRunId" IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM "DiscoveryRun" dr
      WHERE dr."id" = dp."discoveryRunId"
  );

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_icpProfileId_fkey" FOREIGN KEY ("icpProfileId") REFERENCES "IcpProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_icpProfileVersionId_fkey" FOREIGN KEY ("icpProfileVersionId") REFERENCES "IcpProfileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredPerson" ADD CONSTRAINT "DiscoveredPerson_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "DiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredPerson" ADD CONSTRAINT "DiscoveredPerson_icpProfileVersionId_fkey" FOREIGN KEY ("icpProfileVersionId") REFERENCES "IcpProfileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadWorkspace" ADD CONSTRAINT "LeadWorkspace_icpProfileVersionId_fkey" FOREIGN KEY ("icpProfileVersionId") REFERENCES "IcpProfileVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
