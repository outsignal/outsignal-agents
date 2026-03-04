import { NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron-auth";
import { checkAllWorkspaces } from "@/lib/inbox-health/monitor";
import { notifyInboxDisconnect, notifySenderHealth, sendSenderHealthDigest } from "@/lib/notifications";
import { notify } from "@/lib/notify";
import { runSenderHealthCheck } from "@/lib/linkedin/health-check";
import { refreshStaleSessions } from "@/lib/linkedin/session-refresh";
import { generateDueInvoices, alertUnpaidBeforeRenewal } from "@/lib/invoices/generator";
import { markAndNotifyOverdueInvoices } from "@/lib/invoices/overdue";

export async function GET(request: Request) {
  if (!validateCronSecret(request)) {
    console.log(
      `[${new Date().toISOString()}] Unauthorized: GET /api/inbox-health/check`,
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Starting inbox health check`);

  try {
    const changes = await checkAllWorkspaces();

    for (const change of changes) {
      const hasNewDisconnections = change.newDisconnections.length > 0;
      const hasPersistentDisconnections = change.persistentDisconnections.length > 0;

      if (hasNewDisconnections || hasPersistentDisconnections) {
        // Email notification (no client Slack — ops Slack handled by notify() below)
        await notifyInboxDisconnect(change);

        // In-app notification + ops Slack
        const parts: string[] = [];
        if (hasNewDisconnections) {
          parts.push(
            `${change.newDisconnections.length} newly disconnected: ${change.newDisconnections.slice(0, 5).join(", ")}${change.newDisconnections.length > 5 ? ` (+${change.newDisconnections.length - 5} more)` : ""}`,
          );
        }
        if (hasPersistentDisconnections) {
          parts.push(
            `${change.persistentDisconnections.length} still disconnected: ${change.persistentDisconnections.slice(0, 5).join(", ")}${change.persistentDisconnections.length > 5 ? ` (+${change.persistentDisconnections.length - 5} more)` : ""}`,
          );
        }

        await notify({
          type: "system",
          severity: hasNewDisconnections ? "error" : "warning",
          title: hasNewDisconnections
            ? `${change.newDisconnections.length} inbox${change.newDisconnections.length !== 1 ? "es" : ""} disconnected`
            : `${change.persistentDisconnections.length} inbox${change.persistentDisconnections.length !== 1 ? "es" : ""} still disconnected`,
          message: `${change.workspaceName}: ${parts.join(" | ")}`,
          workspaceSlug: change.workspaceSlug,
          metadata: {
            newDisconnections: change.newDisconnections,
            persistentDisconnections: change.persistentDisconnections,
            reconnections: change.reconnections,
            totalDisconnected: change.totalDisconnected,
            totalConnected: change.totalConnected,
          },
        });
      }

      if (change.reconnections.length > 0 && !hasNewDisconnections && !hasPersistentDisconnections) {
        await notify({
          type: "system",
          severity: "info",
          title: `${change.reconnections.length} inbox${change.reconnections.length !== 1 ? "es" : ""} reconnected`,
          message: `${change.workspaceName}: ${change.reconnections.slice(0, 5).join(", ")}`,
          workspaceSlug: change.workspaceSlug,
        });
      }
    }

    console.log(
      `[${timestamp}] Inbox health check complete: ${changes.length} workspace(s) with changes`,
    );

    // --- Sender Health Check ---
    const healthResults = await runSenderHealthCheck();

    // --- Process sender health results ---
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
          console.error(`[sender-health] Critical notification failed for ${result.senderName}:`, err);
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
        console.error("[sender-health] Digest notification failed:", err);
      }
    }

    const criticalCount = healthResults.filter((r) => r.severity === "critical").length;
    const warningCount = warningsForDigest.length;

    console.log(
      `[${timestamp}] Sender health check complete: ${healthResults.length} result(s) (${criticalCount} critical, ${warningCount} warnings)`,
    );

    // --- Session Refresh ---
    const sessionRefreshResult = await refreshStaleSessions();
    if (sessionRefreshResult.count > 0) {
      console.log(`[${timestamp}] Session refresh: flagged ${sessionRefreshResult.count} stale sessions`);
    }

    // --- Invoice Auto-Generation ---
    const invoiceGenResult = await generateDueInvoices();
    console.log(
      `[${timestamp}] Invoice generation: ${invoiceGenResult.created} created, ${invoiceGenResult.skipped} skipped`
    );

    // --- Overdue Invoice Detection ---
    const overdueCount = await markAndNotifyOverdueInvoices();
    if (overdueCount > 0) {
      console.log(`[${timestamp}] Overdue invoices: ${overdueCount} marked overdue`);
    }

    // --- 48h Unpaid Renewal Alert ---
    const unpaidAlertCount = await alertUnpaidBeforeRenewal();
    if (unpaidAlertCount > 0) {
      console.log(`[${timestamp}] Unpaid renewal alerts: ${unpaidAlertCount} sent`);
    }

    return NextResponse.json({
      checked: changes.length,
      workspacesWithChanges: changes.map((c) => ({
        workspace: c.workspaceSlug,
        newDisconnections: c.newDisconnections.length,
        persistentDisconnections: c.persistentDisconnections.length,
        reconnections: c.reconnections.length,
      })),
      healthChecked: healthResults.length,
      healthCritical: criticalCount,
      healthWarnings: warningCount,
      sessionRefreshCount: sessionRefreshResult.count,
      invoicesGenerated: invoiceGenResult.created,
      invoicesSkipped: invoiceGenResult.skipped,
      overdueInvoices: overdueCount,
      unpaidRenewalAlerts: unpaidAlertCount,
    });
  } catch (error) {
    console.error("[inbox-health/check] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Check failed" },
      { status: 500 },
    );
  }
}
