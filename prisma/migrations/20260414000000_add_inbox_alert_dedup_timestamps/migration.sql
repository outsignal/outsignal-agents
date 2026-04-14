-- Per-bucket alert dedup timestamps on InboxStatusSnapshot.
-- See trigger/inbox-check.ts for the 24h dedup window usage. `newNew`
-- alerts fire immediately (regression signal) so lastNewAlertAt is written
-- but never gates firing; the other four timestamps gate re-alerts at 24h.
-- AlterTable
ALTER TABLE "InboxStatusSnapshot" ADD COLUMN     "lastCriticalAlertAt" TIMESTAMP(3),
ADD COLUMN     "lastNewAlertAt" TIMESTAMP(3),
ADD COLUMN     "lastPersistentAlertAt" TIMESTAMP(3),
ADD COLUMN     "lastRecentAlertAt" TIMESTAMP(3),
ADD COLUMN     "lastStaleAlertAt" TIMESTAMP(3);
