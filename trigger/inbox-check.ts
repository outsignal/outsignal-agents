import { schedules } from "@trigger.dev/sdk";
import { checkAllWorkspaces } from "@/lib/inbox-health/monitor";
import { notifyInboxDisconnect } from "@/lib/notifications";
import { notify } from "@/lib/notify";
import { runSenderHealthCheck } from "@/lib/linkedin/health-check";
import { notifySenderHealth, sendSenderHealthDigest } from "@/lib/notifications";
import { refreshStaleSessions } from "@/lib/linkedin/session-refresh";
import { runSyncSenders } from "./sync-senders";
import { syncExclusionsWithEmailBison } from "@/lib/exclusions";
import { prisma } from "@/lib/db";

export const inboxCheckTask = schedules.task({
  id: "inbox-check",
  cron: "0 6 * * *", // daily at 6am UTC
  maxDuration: 300,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },

  run: async () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [inbox-check] Starting inbox connectivity check`);

    const changes = await checkAllWorkspaces();

    // Per-bucket alert dedup window. New disconnects always fire (those need
    // immediate investigation), but the persistent/critical/stale/recent
    // buckets re-fire at most once every 24h to avoid Slack flooding when a
    // workspace stays in a known-bad state across multiple ticks. Schema
    // fields live on InboxStatusSnapshot (Blocker 2.3).
    const ALERT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
    const dedupAllows = (lastAt: Date | null | undefined): boolean => {
      if (!lastAt) return true;
      return Date.now() - lastAt.getTime() >= ALERT_DEDUP_WINDOW_MS;
    };

    for (const change of changes) {
      const hasNew = change.newDisconnections.length > 0;
      const hasRecent = change.recentDisconnections.length > 0;
      const hasPersistent = change.persistentDisconnections.length > 0;
      const hasCritical = change.criticalDisconnections.length > 0;
      const hasStale = change.staleProvisioning.length > 0;

      const hasAnyDisconnectAlert =
        hasNew || hasRecent || hasPersistent || hasCritical || hasStale;

      // Load this workspace's alert dedup state. Snapshot is upserted by
      // checkWorkspace() above, so it should exist whenever the workspace
      // had any disconnect activity. If it's somehow missing, all buckets
      // fall through to the "fire" branch — safe default.
      const snapshot = hasAnyDisconnectAlert
        ? await prisma.inboxStatusSnapshot.findUnique({
            where: { workspaceSlug: change.workspaceSlug },
            select: {
              lastNewAlertAt: true,
              lastRecentAlertAt: true,
              lastPersistentAlertAt: true,
              lastCriticalAlertAt: true,
              lastStaleAlertAt: true,
            },
          })
        : null;

      // Track which alert buckets actually fired this tick so we can update
      // their timestamps in a single write at the end of the loop.
      const firedBuckets: {
        new?: boolean;
        recent?: boolean;
        persistent?: boolean;
        critical?: boolean;
        stale?: boolean;
      } = {};

      if (hasAnyDisconnectAlert) {
        // Email notification (no client Slack — ops Slack handled by notify() below)
        await notifyInboxDisconnect(change);

        // --- In-app notification + ops Slack ---
        // Preview helper: list up to 5 emails with age, " (+N more)".
        const preview = (
          entries: { email: string; ageDays: number }[],
          n = 5,
        ): string => {
          const shown = entries
            .slice(0, n)
            .map((e) =>
              e.ageDays === 0
                ? e.email
                : `${e.email} (${e.ageDays}d)`,
            )
            .join(", ");
          const overflow =
            entries.length > n ? ` (+${entries.length - n} more)` : "";
          return `${shown}${overflow}`;
        };

        // Critical alerts fire as a separate, explicit error-severity
        // notification so they cannot get lost in the daily digest.
        // Dedup'd at 24h — re-firing every tick adds noise, the state
        // is already known-bad and tracked in the workspace.
        if (hasCritical && dedupAllows(snapshot?.lastCriticalAlertAt)) {
          await notify({
            type: "system",
            severity: "error",
            title: `CRITICAL: ${change.criticalDisconnections.length} inbox${change.criticalDisconnections.length !== 1 ? "es" : ""} disconnected >7 days — needs immediate action`,
            message: `${change.workspaceName}: ${preview(change.criticalDisconnections)}`,
            workspaceSlug: change.workspaceSlug,
            metadata: {
              criticalDisconnections: change.criticalDisconnections,
              totalDisconnected: change.totalDisconnected,
              totalConnected: change.totalConnected,
            },
          });
          firedBuckets.critical = true;
        }

        // Stale provisioning is a separate category — "needs onboarding"
        // rather than "needs investigation". Routed as warning because
        // these inboxes were never authenticated in the first place; no
        // recent regression has occurred. Dedup'd at 24h.
        if (hasStale && dedupAllows(snapshot?.lastStaleAlertAt)) {
          await notify({
            type: "system",
            severity: "warning",
            title: `${change.staleProvisioning.length} inbox${change.staleProvisioning.length !== 1 ? "es" : ""} never authenticated — needs onboarding`,
            message: `${change.workspaceName}: ${preview(change.staleProvisioning)}`,
            workspaceSlug: change.workspaceSlug,
            metadata: {
              staleProvisioning: change.staleProvisioning,
              totalDisconnected: change.totalDisconnected,
              totalConnected: change.totalConnected,
            },
          });
          firedBuckets.stale = true;
        }

        // Combined alert for genuine disconnects (new + recent +
        // persistent). Severity is "error" if there is at least one new
        // disconnect (possible regression), otherwise "warning".
        //
        // Dedup gating:
        //   - new disconnects always fire (genuine regression — always
        //     worth investigating, no dedup)
        //   - persistent/recent fire at most every 24h via dedupAllows
        //   - if all gated buckets are within their dedup window AND
        //     there are no new disconnects, suppress the combined alert
        const fireNew = hasNew; // never deduped
        const firePersistent =
          hasPersistent && dedupAllows(snapshot?.lastPersistentAlertAt);
        const fireRecent =
          hasRecent && dedupAllows(snapshot?.lastRecentAlertAt);

        if (fireNew || fireRecent || firePersistent) {
          // Only describe buckets that are actually firing — buckets in
          // their dedup window are silently skipped to avoid re-stating
          // a known-bad state.
          const parts: string[] = [];
          if (fireNew) {
            parts.push(
              `${change.newDisconnections.length} newly disconnected: ${preview(change.newDisconnections)}`,
            );
          }
          if (fireRecent) {
            parts.push(
              `${change.recentDisconnections.length} recently disconnected (1-3d): ${preview(change.recentDisconnections)}`,
            );
          }
          if (firePersistent) {
            parts.push(
              `${change.persistentDisconnections.length} persistent (3-7d): ${preview(change.persistentDisconnections)}`,
            );
          }

          const primaryCount = fireNew
            ? change.newDisconnections.length
            : firePersistent
              ? change.persistentDisconnections.length
              : change.recentDisconnections.length;

          const title = fireNew
            ? `${primaryCount} inbox${primaryCount !== 1 ? "es" : ""} newly disconnected`
            : firePersistent
              ? `${primaryCount} inbox${primaryCount !== 1 ? "es" : ""} persistently disconnected (3-7 days)`
              : `${primaryCount} inbox${primaryCount !== 1 ? "es" : ""} recently disconnected`;

          await notify({
            type: "system",
            severity: fireNew ? "error" : "warning",
            title,
            message: `${change.workspaceName}: ${parts.join(" | ")}`,
            workspaceSlug: change.workspaceSlug,
            metadata: {
              newDisconnections: change.newDisconnections,
              recentDisconnections: change.recentDisconnections,
              persistentDisconnections: change.persistentDisconnections,
              reconnections: change.reconnections,
              totalDisconnected: change.totalDisconnected,
              totalConnected: change.totalConnected,
            },
          });
          if (fireNew) firedBuckets.new = true;
          if (fireRecent) firedBuckets.recent = true;
          if (firePersistent) firedBuckets.persistent = true;
        }
      }

      // Persist the alert timestamps for any bucket that fired this tick
      // so subsequent ticks can honour the 24h dedup window. We scope the
      // write to "fired only" so a bucket that didn't fire keeps its
      // previous timestamp (or remains null), which preserves correct
      // dedup behaviour across mixed-bucket ticks.
      const dedupUpdates: Record<string, Date> = {};
      const nowDate = new Date();
      if (firedBuckets.new) dedupUpdates.lastNewAlertAt = nowDate;
      if (firedBuckets.recent) dedupUpdates.lastRecentAlertAt = nowDate;
      if (firedBuckets.persistent) dedupUpdates.lastPersistentAlertAt = nowDate;
      if (firedBuckets.critical) dedupUpdates.lastCriticalAlertAt = nowDate;
      if (firedBuckets.stale) dedupUpdates.lastStaleAlertAt = nowDate;
      if (Object.keys(dedupUpdates).length > 0) {
        try {
          await prisma.inboxStatusSnapshot.update({
            where: { workspaceSlug: change.workspaceSlug },
            data: dedupUpdates,
          });
        } catch (err) {
          // Non-fatal: dedup state is best-effort. If the snapshot row was
          // deleted between the read and write, the worst case is one
          // duplicate alert next tick.
          console.warn(
            `[inbox-check] Failed to persist alert dedup state for ${change.workspaceSlug}:`,
            err,
          );
        }
      }

      if (change.reconnections.length > 0) {
        await notify({
          type: "system",
          severity: "info",
          title: `${change.reconnections.length} inbox${change.reconnections.length !== 1 ? "es" : ""} reconnected`,
          message: `${change.workspaceName}: ${change.reconnections.slice(0, 5).join(", ")}`,
          workspaceSlug: change.workspaceSlug,
          metadata: {
            reconnections: change.reconnections,
          },
        });
      }
    }

    console.log(
      `[${timestamp}] [inbox-check] Step 1 complete: ${changes.length} workspace(s) with changes`,
    );

    // -----------------------------------------------------------------------
    // Step 2: Sender health check (merged from inbox-sender-health)
    // -----------------------------------------------------------------------
    console.log(`[${timestamp}] [inbox-check] Step 2: Sender health check`);

    const healthResults = await runSenderHealthCheck();

    const warningsForDigest: Array<{
      workspaceSlug: string;
      senderName: string;
      reason: string;
      detail: string;
    }> = [];

    for (const result of healthResults) {
      if (result.severity === "critical") {
        // Critical: fire immediate Slack + email notification
        try {
          await notifySenderHealth({
            workspaceSlug: result.workspaceSlug,
            senderName: result.senderName,
            reason: result.reason,
            detail: result.detail,
            severity: "critical",
            reassignedCount: result.reassignedCount,
            workspacePaused: result.workspacePaused,
          });
        } catch (err) {
          console.error(`[inbox-check] Critical notification failed for ${result.senderName}:`, err);
        }

        // Also write to in-app notification + ops Slack
        await notify({
          type: "system",
          severity: "error",
          title: `Sender flagged: ${result.senderName}`,
          message: result.detail,
          workspaceSlug: result.workspaceSlug,
          metadata: {
            senderId: result.senderId,
            reason: result.reason,
            reassignedCount: result.reassignedCount,
            workspacePaused: result.workspacePaused,
          },
        });
      } else {
        // Warning: collect for daily digest
        warningsForDigest.push({
          workspaceSlug: result.workspaceSlug,
          senderName: result.senderName,
          reason: result.reason,
          detail: result.detail,
        });
      }
    }

    // Send daily digest for warning-level events (Slack only)
    if (warningsForDigest.length > 0) {
      try {
        await sendSenderHealthDigest({ warnings: warningsForDigest });
      } catch (err) {
        console.error("[inbox-check] Digest notification failed:", err);
      }
    }

    const criticalCount = healthResults.filter((r) => r.severity === "critical").length;
    const warningCount = warningsForDigest.length;

    // Session refresh logically belongs with sender health
    const sessionRefreshResult = await refreshStaleSessions();
    if (sessionRefreshResult.count > 0) {
      console.log(`[${timestamp}] [inbox-check] Session refresh: flagged ${sessionRefreshResult.count} stale sessions`);
    }

    console.log(
      `[${timestamp}] [inbox-check] Step 2 complete: ${healthResults.length} result(s) (${criticalCount} critical, ${warningCount} warnings)`,
    );

    // -----------------------------------------------------------------------
    // Step 3: Sync senders (merged from sync-senders scheduled task)
    // -----------------------------------------------------------------------
    console.log("[inbox-check] Running sync-senders...");
    const syncResult = await runSyncSenders();

    // -----------------------------------------------------------------------
    // Step 4: Sync exclusions with EmailBison blacklists
    // -----------------------------------------------------------------------
    console.log("[inbox-check] Step 4: Exclusion sync with EmailBison");

    const workspacesWithTokens = await prisma.workspace.findMany({
      where: { apiToken: { not: null } },
      select: { slug: true },
    });

    const exclusionSyncResults: Array<{
      workspace: string;
      pulledFromEB: number;
      pushedToEB: number;
      alreadySynced: number;
      emailsPulledFromEB: number;
      emailsPushedToEB: number;
      emailsAlreadySynced: number;
    }> = [];

    for (const ws of workspacesWithTokens) {
      try {
        const result = await syncExclusionsWithEmailBison(ws.slug);
        exclusionSyncResults.push({ workspace: ws.slug, ...result });
      } catch (err) {
        console.error(`[inbox-check] Exclusion sync failed for ${ws.slug}:`, err);
      }
    }

    const totalPulled = exclusionSyncResults.reduce((s, r) => s + r.pulledFromEB, 0);
    const totalPushed = exclusionSyncResults.reduce((s, r) => s + r.pushedToEB, 0);
    const totalEmailsPulled = exclusionSyncResults.reduce((s, r) => s + r.emailsPulledFromEB, 0);
    const totalEmailsPushed = exclusionSyncResults.reduce((s, r) => s + r.emailsPushedToEB, 0);

    console.log(
      `[inbox-check] Step 4 complete: ${exclusionSyncResults.length} workspace(s), domains: ${totalPulled} pulled/${totalPushed} pushed, emails: ${totalEmailsPulled} pulled/${totalEmailsPushed} pushed`,
    );

    return {
      checked: changes.length,
      workspacesWithChanges: changes.map((c) => ({
        workspace: c.workspaceSlug,
        newDisconnections: c.newDisconnections.length,
        recentDisconnections: c.recentDisconnections.length,
        persistentDisconnections: c.persistentDisconnections.length,
        criticalDisconnections: c.criticalDisconnections.length,
        staleProvisioning: c.staleProvisioning.length,
        reconnections: c.reconnections.length,
      })),
      senderHealth: {
        healthChecked: healthResults.length,
        critical: criticalCount,
        warnings: warningCount,
        sessionRefreshCount: sessionRefreshResult.count,
      },
      senderSync: {
        workspaces: syncResult.workspaces,
        synced: syncResult.synced,
        created: syncResult.created,
        skipped: syncResult.skipped,
        errors: syncResult.errors.length,
      },
      exclusionSync: {
        workspaces: exclusionSyncResults.length,
        totalPulled,
        totalPushed,
      },
    };
  },
});
