-- Add durable first-connection tracking so inbox health can distinguish
-- never-onboarded inboxes from previously connected inboxes that later dropped.
ALTER TABLE "Sender"
ADD COLUMN "firstConnectedAt" TIMESTAMP(3);
