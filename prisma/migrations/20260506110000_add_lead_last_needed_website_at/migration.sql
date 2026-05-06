-- Track leads whose ICP score is blocked on missing company website content.
ALTER TABLE "Lead" ADD COLUMN "lastNeededWebsiteAt" TIMESTAMP(3);

CREATE INDEX "Lead_lastNeededWebsiteAt_idx" ON "Lead"("lastNeededWebsiteAt");
