-- Fix the LinkedInAction hot-path index to match sender-scoped polling.
-- The worker claims pending actions by (senderId, status, scheduledFor),
-- not by workspaceSlug.

DROP INDEX IF EXISTS "LinkedInAction_workspaceSlug_status_scheduledFor_idx";
DROP INDEX IF EXISTS "LinkedInAction_senderId_status_idx";

CREATE INDEX "LinkedInAction_senderId_status_scheduledFor_idx"
ON "LinkedInAction"("senderId", "status", "scheduledFor");
