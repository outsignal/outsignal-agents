import { NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron-auth";
import { checkAllWorkspaces } from "@/lib/inbox-health/monitor";
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
      const hasNewDisconnections = change.newDisconnections.length > 0;
      const hasPersistentDisconnections = change.persistentDisconnections.length > 0;

      if (hasNewDisconnections || hasPersistentDisconnections) {
        // Ops-only notification (in-app + ops Slack channel)
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

    return NextResponse.json({
      checked: changes.length,
      workspacesWithChanges: changes.map((c) => ({
        workspace: c.workspaceSlug,
        newDisconnections: c.newDisconnections.length,
        persistentDisconnections: c.persistentDisconnections.length,
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
