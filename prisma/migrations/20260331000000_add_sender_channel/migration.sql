-- Add channel field to Sender table
ALTER TABLE "Sender" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'email';

-- Backfill: senders with emailBisonSenderId AND LinkedIn fields = "both"
UPDATE "Sender" SET "channel" = 'both'
WHERE "emailBisonSenderId" IS NOT NULL
  AND ("linkedinProfileUrl" IS NOT NULL OR "loginMethod" != 'none');

-- Backfill: senders without emailBisonSenderId but with LinkedIn fields = "linkedin"
UPDATE "Sender" SET "channel" = 'linkedin'
WHERE "emailBisonSenderId" IS NULL
  AND ("linkedinProfileUrl" IS NOT NULL OR "loginMethod" != 'none');

-- Remaining senders keep the default "email"

-- Add index
CREATE INDEX "Sender_channel_idx" ON "Sender"("channel");
