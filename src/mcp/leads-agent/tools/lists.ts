/**
 * List management tools for the Outsignal Leads Agent MCP server.
 *
 * Lists are stored as TargetList + TargetListPerson rows (same model as
 * the Phase 4 UI and Phase 5 export tools).
 *
 * Tools registered:
 *   - create_list: Create a named TargetList in a workspace.
 *   - add_to_list: Add people to a TargetList via TargetListPerson.
 *   - view_list: View people in a TargetList with enrichment status.
 *
 * CRITICAL: No console.log — stdout is reserved for JSON-RPC protocol messages.
 * Use console.error for logging.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";

export function registerListTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // create_list
  // ---------------------------------------------------------------------------
  server.tool(
    "create_list",
    "Create a named TargetList in a workspace. Returns the list ID for use with add_to_list and export tools.",
    {
      name: z.string().describe("Name of the list to create"),
      workspace: z.string().describe("Workspace slug"),
      description: z.string().optional().describe("Optional list description"),
    },
    async (params) => {
      const { name, workspace, description } = params;

      // Validate workspace exists
      await prisma.workspace.findUniqueOrThrow({ where: { slug: workspace } });

      const list = await prisma.targetList.create({
        data: {
          name,
          workspaceSlug: workspace,
          description: description ?? null,
        },
      });

      const text = `List '${name}' created (ID: ${list.id}) in workspace '${workspace}'. Use add_to_list with this list_id to add people.`;
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ---------------------------------------------------------------------------
  // add_to_list
  // ---------------------------------------------------------------------------
  server.tool(
    "add_to_list",
    "Add people to a TargetList by list ID.",
    {
      list_id: z.string().describe("TargetList ID (from create_list)"),
      person_ids: z.array(z.string()).describe("Array of Person IDs to add"),
    },
    async (params) => {
      const { list_id, person_ids } = params;

      // Validate list exists
      const list = await prisma.targetList.findUnique({
        where: { id: list_id },
        select: { id: true, name: true },
      });
      if (!list) {
        return {
          content: [
            { type: "text" as const, text: `Error: TargetList '${list_id}' not found.` },
          ],
        };
      }

      let addedCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];

      for (const personId of person_ids) {
        try {
          await prisma.targetListPerson.create({
            data: { listId: list_id, personId },
          });
          addedCount++;
        } catch (err) {
          // Unique constraint violation = already in list
          if (
            err instanceof Error &&
            err.message.includes("Unique constraint")
          ) {
            skippedCount++;
            continue;
          }
          console.error(`[add_to_list] Error for person ${personId}:`, err);
          errors.push(
            `Person ${personId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      let text = `Added ${addedCount} people to list '${list.name}'.`;
      if (skippedCount > 0) {
        text += ` ${skippedCount} already in list.`;
      }
      if (errors.length > 0) {
        text += `\n\nErrors (${errors.length}):\n${errors.join("\n")}`;
      }

      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ---------------------------------------------------------------------------
  // view_list
  // ---------------------------------------------------------------------------
  server.tool(
    "view_list",
    "View people in a TargetList with their enrichment status and ICP score.",
    {
      list_id: z.string().describe("TargetList ID to view"),
      limit: z.number().default(50).describe("Max people to return"),
    },
    async (params) => {
      const { list_id, limit } = params;

      const list = await prisma.targetList.findUnique({
        where: { id: list_id },
        select: { id: true, name: true, workspaceSlug: true },
      });
      if (!list) {
        return {
          content: [
            { type: "text" as const, text: `Error: TargetList '${list_id}' not found.` },
          ],
        };
      }

      const entries = await prisma.targetListPerson.findMany({
        where: { listId: list_id },
        take: limit,
        include: {
          person: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              company: true,
              status: true,
            },
          },
        },
      });

      // Get ICP scores from PersonWorkspace for this workspace
      const personIds = entries.map((e) => e.personId);
      const pws = await prisma.personWorkspace.findMany({
        where: {
          personId: { in: personIds },
          workspace: list.workspaceSlug,
        },
        select: { personId: true, icpScore: true },
      });
      const icpMap = new Map(pws.map((pw) => [pw.personId, pw.icpScore]));

      const totalCount = await prisma.targetListPerson.count({
        where: { listId: list_id },
      });

      if (entries.length === 0) {
        const text = `0 people in list '${list.name}'. Use add_to_list to add people.`;
        return { content: [{ type: "text" as const, text }] };
      }

      const header = "| Name | Email | Company | ICP Score | Status |";
      const divider = "|------|-------|---------|-----------|--------|";
      const escape = (s: string) => s.replace(/\|/g, "\\|");
      const rows = entries.map((entry) => {
        const p = entry.person;
        const name =
          [p.firstName, p.lastName].filter(Boolean).join(" ") || "_Unknown_";
        const company = p.company ?? "_—_";
        const score = icpMap.get(entry.personId);
        const scoreStr = score !== null && score !== undefined ? `${score}/100` : "_—_";
        return `| ${escape(name)} | ${escape(p.email)} | ${escape(company)} | ${scoreStr} | ${escape(p.status)} |`;
      });

      const table = [header, divider, ...rows].join("\n");
      const showing = entries.length < totalCount ? ` (showing ${entries.length})` : "";
      const text = `${totalCount} people in list '${list.name}'${showing}:\n\n${table}`;

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
