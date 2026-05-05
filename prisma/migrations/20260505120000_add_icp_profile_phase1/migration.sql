-- CreateTable
CREATE TABLE "IcpProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IcpProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IcpProfileVersion" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "targetTitles" JSONB,
    "locations" JSONB,
    "industries" JSONB,
    "companySizes" JSONB,
    "scoringRubric" JSONB,
    "createdBy" TEXT,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IcpProfileVersion_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "defaultIcpProfileId" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "icpProfileId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "IcpProfile_workspaceId_slug_key" ON "IcpProfile"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "IcpProfile_workspaceId_active_idx" ON "IcpProfile"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "IcpProfileVersion_profileId_version_key" ON "IcpProfileVersion"("profileId", "version");

-- CreateIndex
CREATE INDEX "IcpProfileVersion_profileId_idx" ON "IcpProfileVersion"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_defaultIcpProfileId_key" ON "Workspace"("defaultIcpProfileId");

-- CreateIndex
CREATE INDEX "Campaign_icpProfileId_idx" ON "Campaign"("icpProfileId");

-- AddForeignKey
ALTER TABLE "IcpProfile" ADD CONSTRAINT "IcpProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpProfileVersion" ADD CONSTRAINT "IcpProfileVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "IcpProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill one active default ICP profile shell per workspace. Behavior does
-- not change in Phase 1; legacy Workspace fields remain the active read path.
INSERT INTO "IcpProfile" (
    "id",
    "workspaceId",
    "slug",
    "name",
    "active",
    "currentVersion",
    "createdAt",
    "updatedAt"
)
SELECT
    'icp_' || w."id",
    w."id",
    'default-legacy-import',
    w."name" || ' — Default (legacy import)',
    true,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Workspace" w
ON CONFLICT ("workspaceId", "slug") DO NOTHING;

-- Backfill version 1 from legacy Workspace ICP fields. icpCriteriaPrompt is
-- copied into description because it is the active LLM scorer prompt today.
-- Legacy ICP fields are free-text prose, not reliable comma-separated lists,
-- so structured arrays remain null until explicit curation in a later phase.
INSERT INTO "IcpProfileVersion" (
    "id",
    "profileId",
    "version",
    "description",
    "targetTitles",
    "locations",
    "industries",
    "companySizes",
    "scoringRubric",
    "changeReason",
    "createdAt"
)
SELECT
    'icpv_' || w."id" || '_v1',
    'icp_' || w."id",
    1,
    COALESCE(
        NULLIF(BTRIM(w."icpCriteriaPrompt"), ''),
        'Legacy workspace ICP imported from workspace fields.'
    ),
    NULL,
    NULL,
    NULL,
    NULL,
    jsonb_strip_nulls(jsonb_build_object(
        'legacySource', 'Workspace',
        'icpCriteriaPrompt', NULLIF(BTRIM(w."icpCriteriaPrompt"), ''),
        'icpCountries', NULLIF(BTRIM(w."icpCountries"), ''),
        'icpIndustries', NULLIF(BTRIM(w."icpIndustries"), ''),
        'icpCompanySize', NULLIF(BTRIM(w."icpCompanySize"), ''),
        'icpDecisionMakerTitles', NULLIF(BTRIM(w."icpDecisionMakerTitles"), ''),
        'icpKeywords', NULLIF(BTRIM(w."icpKeywords"), ''),
        'icpExclusionCriteria', NULLIF(BTRIM(w."icpExclusionCriteria"), ''),
        'icpScoreThreshold', w."icpScoreThreshold"
    )),
    'Imported 2026-05-05 from legacy workspace fields',
    CURRENT_TIMESTAMP
FROM "Workspace" w
ON CONFLICT ("profileId", "version") DO NOTHING;

UPDATE "Workspace" w
SET "defaultIcpProfileId" = 'icp_' || w."id"
WHERE w."defaultIcpProfileId" IS NULL
  AND EXISTS (
      SELECT 1
      FROM "IcpProfile" p
      WHERE p."id" = 'icp_' || w."id"
  );

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_defaultIcpProfileId_fkey" FOREIGN KEY ("defaultIcpProfileId") REFERENCES "IcpProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_icpProfileId_fkey" FOREIGN KEY ("icpProfileId") REFERENCES "IcpProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
