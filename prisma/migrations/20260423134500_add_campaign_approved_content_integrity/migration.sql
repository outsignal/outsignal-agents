-- Add approved-content integrity fields so portal approvals can persist
-- the exact sequence snapshot and its hash for drift detection.

ALTER TABLE "Campaign"
ADD COLUMN "approvedContentHash" TEXT,
ADD COLUMN "approvedContentSnapshot" JSONB;
