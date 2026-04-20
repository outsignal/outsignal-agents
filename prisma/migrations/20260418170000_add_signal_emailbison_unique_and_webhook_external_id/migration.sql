-- Structural hardening:
--   1. Protect signal campaigns from cross-campaign EmailBison ID corruption
--      by making signalEmailBisonCampaignId unique.
--   2. Replace fragile webhook payload substring dedupe with a structured
--      externalEventId column + unique key.
--
-- Postgres permits multiple NULLs under UNIQUE, so:
--   - campaigns without a signal EB campaign remain unaffected
--   - webhook events without an externalEventId remain insertable

-- Add structured webhook dedupe key
ALTER TABLE "WebhookEvent"
ADD COLUMN IF NOT EXISTS "externalEventId" TEXT;

-- Enforce unique signal EmailBison ownership across campaigns
CREATE UNIQUE INDEX "Campaign_signalEmailBisonCampaignId_key"
ON "Campaign"("signalEmailBisonCampaignId");

-- Enforce structured webhook idempotency for external events (e.g. replies)
CREATE UNIQUE INDEX "WebhookEvent_workspace_eventType_externalEventId_key"
ON "WebhookEvent"("workspace", "eventType", "externalEventId");
