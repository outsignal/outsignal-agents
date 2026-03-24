/**
 * inbox-status.ts
 *
 * CLI wrapper: check inbox connection status for all workspaces or a specific one.
 * Usage: node dist/cli/inbox-status.js [workspaceSlug]
 *
 * Queries sender connection status from EmailBison via checkAllWorkspaces().
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { checkAllWorkspaces } from "@/lib/inbox-health/monitor";
import { prisma } from "@/lib/db";

const [, , workspaceSlug] = process.argv;

runWithHarness("inbox-status [workspaceSlug]", async () => {
  if (workspaceSlug) {
    // Single workspace — query just that one
    const ws = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { slug: true, name: true, apiToken: true },
    });
    if (!ws) throw new Error(`Workspace '${workspaceSlug}' not found`);
    if (!ws.apiToken) return { workspaceSlug, message: "No API token configured for this workspace" };

    // Run check for all workspaces, filter to requested one
    const results = await checkAllWorkspaces();
    const wsResult = results.find(r => r.workspaceSlug === workspaceSlug);
    return wsResult ?? { workspaceSlug, message: "No status changes detected" };
  }

  // All workspaces
  const results = await checkAllWorkspaces();
  return { results, total: results.length };
});
