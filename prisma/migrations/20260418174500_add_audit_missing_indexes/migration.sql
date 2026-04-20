-- Audit hardening: add the remaining compound/cleanup indexes identified in
-- the April 17 comprehensive platform audit.
--
-- These indexes support:
--   1. Workspace-scoped pending LinkedIn action polling
--   2. Workspace-scoped unhealthy sender lookups
--   3. Workspace-scoped active signal queries
--   4. Expired magic-link cleanup

CREATE INDEX "LinkedInAction_workspaceSlug_status_scheduledFor_idx"
ON "LinkedInAction"("workspaceSlug", "status", "scheduledFor");

CREATE INDEX "Sender_workspaceSlug_healthStatus_status_idx"
ON "Sender"("workspaceSlug", "healthStatus", "status");

CREATE INDEX "SignalEvent_workspaceSlug_status_detectedAt_idx"
ON "SignalEvent"("workspaceSlug", "status", "detectedAt");

CREATE INDEX "MagicLinkToken_expiresAt_idx"
ON "MagicLinkToken"("expiresAt");
