import { NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron-auth";
import { checkAllWorkspaces } from "@/lib/inbox-health/monitor";
import { notifyInboxDisconnect } from "@/lib/notifications";
import { notify } from "@/lib/notify";

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
      if (change.newDisconnections.length > 0) {
        // Workspace-specific notification (Slack channel + email)
        await notifyInboxDisconnect(change);

        // In-app notification + ops Slack
        await notify({
          type: "system",
          severity: "error",
          title: `${change.newDisconnections.length} inbox${change.newDisconnections.length !== 1 ? "es" : ""} disconnected`,
          message: `${change.workspaceName}: ${change.newDisconnections.slice(0, 5).join(", ")}${change.newDisconnections.length > 5 ? ` (+${change.newDisconnections.length - 5} more)` : ""}`,
          workspaceSlug: change.workspaceSlug,
          metadata: {
            newDisconnections: change.newDisconnections,
            reconnections: change.reconnections,
            totalDisconnected: change.totalDisconnected,
            totalConnected: change.totalConnected,
          },
        });
      }

      if (change.reconnections.length > 0 && change.newDisconnections.length === 0) {
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

    return NextResponse.json({
      checked: changes.length,
      workspacesWithChanges: changes.map((c) => ({
        workspace: c.workspaceSlug,
        disconnections: c.newDisconnections.length,
        reconnections: c.reconnections.length,
      })),
    });
  } catch (error) {
    console.error("[inbox-health/check] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Check failed" },
      { status: 500 },
    );
  }
}
