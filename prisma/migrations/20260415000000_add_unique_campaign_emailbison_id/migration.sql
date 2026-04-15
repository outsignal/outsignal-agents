-- BL-070: close concurrent-deploy race on Campaign.emailBisonCampaignId.
-- Two deploys of the same Campaign could both win Step 1 (createCampaign on
-- EmailBison) and then race the Step 2 write-back, with the later write
-- silently overwriting the earlier and orphaning one EB campaign. With a
-- unique constraint, the losing writer gets P2002 and the email-adapter
-- code path can delete the orphan EB campaign and continue with the winner.
--
-- Postgres treats multiple NULLs as distinct under UNIQUE, so existing
-- unlinked Campaign rows (emailBisonCampaignId IS NULL) are unaffected.
--
-- Pre-check (run against prod before generating this migration) confirmed
-- zero duplicate non-null emailBisonCampaignId rows.
--
-- Note: the pre-existing @@index([emailBisonCampaignId]) is dropped because
-- UNIQUE implies an index; keeping both would duplicate btree maintenance.

-- DropIndex
DROP INDEX IF EXISTS "Campaign_emailBisonCampaignId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_emailBisonCampaignId_key" ON "Campaign"("emailBisonCampaignId");
